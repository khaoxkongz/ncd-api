const { performance: monotonicClock } = require("node:perf_hooks");

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
  const initialRss = process.memoryUsage().rss;
  const metrics = {
    elapsedMS: 0,
    peakRssBytes: initialRss,
    peakAdditionalRssBytes: 0,
    peakSerializedBytes: 0,
    storageBytes: 0,
    peakNativeBytes: 0,
  };
  function check() {
    metrics.elapsedMS = monotonicClock.now() - start;
    metrics.peakRssBytes = Math.max(metrics.peakRssBytes, process.memoryUsage().rss);
    metrics.peakAdditionalRssBytes = Math.max(metrics.peakAdditionalRssBytes, metrics.peakRssBytes - initialRss);
    if (
      signal?.aborted ||
      metrics.elapsedMS >= limits.maxTimeMS ||
      metrics.peakAdditionalRssBytes > limits.maxAdditionalRssBytes
    )
      throw new Error("Read-model deadline, cancellation, or memory budget exceeded");
    const sharedRemaining = remaining ? remaining() : Infinity;
    if (sharedRemaining <= 0) throw new Error("Shared refresh deadline exceeded");
    return Math.max(1, Math.floor(Math.min(limits.maxTimeMS - metrics.elapsedMS, sharedRemaining)));
  }
  return {
    limits,
    metrics,
    check,
    options(extra = {}) {
      return { ...extra, maxTimeMS: check(), batchSize: 1 };
    },
    serialized(bytes) {
      metrics.peakSerializedBytes = Math.max(metrics.peakSerializedBytes, bytes);
      if (bytes > limits.maxSerializedBytes) throw new Error("Serialized buffer budget exceeded");
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
}

module.exports = { createBudget };
