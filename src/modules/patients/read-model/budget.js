const { performance: monotonicClock } = require("node:perf_hooks");
const capacity = require("./capacity");
const { BSON } = require("mongodb");

function createBudget(input, { request = false, signal, remaining } = {}) {
  const ceilings = {
    maxTimeMS: request ? 60000 : 6 * 60 * 60 * 1000,
    maxSerializedBytes: 8 * 1048576,
    maxChunkBytes: 1048576,
    maxPayloadBytes: 960 * 1024,
    maxAdditionalRssBytes: request ? 128 * 1048576 : 512 * 1048576,
  };
  const limits = { ...input };
  for (const [key, ceiling] of Object.entries(ceilings)) {
    if (limits[key] === undefined && request) limits[key] = ceiling;
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > ceiling)
      throw new Error(`Invalid ${key} budget`);
  }
  if (
    !request &&
    (!Number.isSafeInteger(limits.maxStorageBytes) ||
      limits.maxStorageBytes <= 0 ||
      !Number.isSafeInteger(limits.maxSourceBytes) ||
      limits.maxSourceBytes <= 0 ||
      limits.maxHeavyOperations !== 1)
  )
    throw new Error("Declare fixed source/storage budgets and one heavy operation");
  const start = monotonicClock.now();
  const observed = capacity.observation();
  const initialRss = observed.value.baseline.rssBytes;
  const metrics = {
    elapsedMS: 0,
    peakRssBytes: initialRss,
    peakAdditionalRssBytes: 0,
    peakSerializedBytes: 0,
    storageBytes: 0,
    peakNativeBytes: 0,
    observation: observed.value,
    capacity: capacity.absent(),
  };
  const releases = new Set();
  let scratch;
  function check() {
    metrics.elapsedMS = monotonicClock.now() - start;
    const sample = observed.sample();
    metrics.peakRssBytes = sample.peakRssBytes;
    metrics.peakAdditionalRssBytes = sample.peakAdditionalRssBytes;
    if (signal?.aborted || metrics.elapsedMS >= limits.maxTimeMS)
      throw new Error("Read-model deadline or cancellation budget exceeded");
    const sharedRemaining = remaining ? remaining() : Infinity;
    if (sharedRemaining <= 0) throw new Error("Shared refresh deadline exceeded");
    return Math.max(1, Math.floor(Math.min(limits.maxTimeMS - metrics.elapsedMS, sharedRemaining)));
  }
  const budget = {
    limits,
    metrics,
    check,
    wireBytes: 1048576,
    snapshot: () => BSON.deserialize(BSON.serialize(metrics)),
    restore(previous) {
      const history = [...(previous.observationHistory ?? []), ...(previous.observation ? [previous.observation] : [])];
      const unique = new Map(history.map((item) => [item.attempt, item]));
      if (unique.size > 16) throw new Error("Bounded recovery observation history exhausted");
      metrics.observationHistory = [...unique.values()];
      metrics.failureHistory = [...(previous.failureHistory ?? [])];
      metrics.historicalAdditionalRssMaximumBytes = Math.max(
        previous.historicalAdditionalRssMaximumBytes ?? 0,
        ...history.map((item) => item.peakAdditionalRssBytes ?? 0)
      );
      for (const [key, value] of Object.entries(previous))
        if (
          key.startsWith("peak") &&
          !["peakRssBytes", "peakAdditionalRssBytes"].includes(key) &&
          typeof value === "number"
        )
          metrics[key] = Math.max(metrics[key] ?? 0, value);
      if (!previous.observation && Number.isFinite(previous.peakRssBytes))
        metrics.unattributableHistoricalRssBytes = Math.max(
          previous.peakRssBytes,
          previous.unattributableHistoricalRssBytes ?? 0
        );
      // An old absolute RSS reading never participates in a new actor/baseline
      // subtraction. Each process-wide observation retains its own provenance.
    },
    async admitMemory(bytes) {
      await budget.capacity?.admitMemory(bytes);
    },
    async admitAdditional(bytes) {
      await budget.capacity?.admitMemory(budget.capacity.currentBytes() + bytes);
    },
    async reserveSerialized(bytes) {
      const lease = await budget.capacity?.reserveSerialized(bytes);
      if (!lease) return { hold: () => () => {}, grow: async () => {}, release: async () => {} };
      return { ...lease, hold: (value) => budget.adopt(lease.hold(value)) };
    },
    adopt(release) {
      releases.add(release);
      return () => {
        releases.delete(release);
        release();
      };
    },
    async flush() {
      await budget.capacity?.flush();
    },
    hold(value, kind = "serialized", bytes) {
      const release = budget.capacity?.hold(value, kind, bytes) ?? (() => {});
      return budget.adopt(release);
    },
    releaseAllocations() {
      for (const release of releases) release();
      releases.clear();
    },
    bitmap(create, cardinality = 0) {
      if (!budget.capacity) return create();
      // A pre-allocation reservation, never a measured codec footprint or a
      // compression assumption. Unknown target/native peaks still fail their
      // evidence gate. Growth must fit an already admitted workspace.
      const pending = new Set();
      const reserve = (count) => {
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid native cardinality reservation");
        const bytes = count * 8 + Math.min(count, 1024) * 512 + 4096;
        const release = budget.hold(null, "reservation", bytes);
        pending.add(release);
        metrics.peakNativeReservationBytes = Math.max(metrics.peakNativeReservationBytes ?? 0, bytes);
        return release;
      };
      let current = reserve(cardinality),
        bitmap;
      try {
        bitmap = create();
      } catch (error) {
        current();
        throw error;
      }
      budget.capacity.native(1);
      const dispose = bitmap.dispose.bind(bitmap);
      let disposed = false;
      for (const method of ["add", "orInPlace"]) {
        const apply = bitmap[method].bind(bitmap);
        bitmap[method] = (...args) => {
          const count = bitmap.size + (method === "add" ? 1 : args[0].size);
          const next = reserve(count);
          const result = apply(...args);
          current();
          pending.delete(current);
          current = next;
          return result;
        };
      }
      bitmap.dispose = () => {
        if (disposed) return;
        dispose();
        disposed = true;
        for (const release of pending) release();
        pending.clear();
        budget.capacity.native(-1);
      };
      return bitmap;
    },
    options(extra = {}) {
      return { ...extra, maxTimeMS: check(), batchSize: 1 };
    },
    serialized(bytes) {
      metrics.peakSerializedBytes = Math.max(metrics.peakSerializedBytes, bytes);
      if (bytes > limits.maxSerializedBytes) throw new Error("Serialized buffer budget exceeded");
      scratch?.();
      scratch = budget.hold(null, "reservation", bytes);
      check();
    },
    storage(bytes) {
      metrics.storageBytes = bytes;
      if (bytes > limits.maxStorageBytes) throw new Error("Storage budget exceeded");
      check();
    },
    native(bytes) {
      metrics.peakNativeBytes = Math.max(metrics.peakNativeBytes, bytes);
      check();
    },
  };
  return budget;
}

module.exports = { createBudget };
