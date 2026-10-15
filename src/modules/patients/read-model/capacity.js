const { performance: monotonicClock } = require("node:perf_hooks");
const { randomUUID } = require("node:crypto");
const { hostname } = require("node:os");

// A process observation is not an isolated response measurement or verified H.
// Worker threads report this same PID/RSS; their observations must not be added.
const ACTOR = Object.freeze({ pid: process.pid, startedAt: Math.round(monotonicClock.timeOrigin), host: hostname() });
const BASELINE = Object.freeze({
  at: Date.now(),
  rssBytes: process.memoryUsage().rss,
  method: "capacity-module-entry-process-sample",
});

function observation() {
  const value = {
    actor: ACTOR,
    attempt: randomUUID(),
    baseline: BASELINE,
    coverage: "sampled-not-complete-peak",
    attribution: "whole-process-includes-workers-and-all-roles",
    peakRssBytes: 0,
    peakAdditionalRssBytes: 0,
    samples: 0,
  };
  return {
    value,
    sample() {
      const memory = process.memoryUsage();
      value.samples += 1;
      value.lastAt = Date.now();
      value.peakRssBytes = Math.max(value.peakRssBytes, memory.rss);
      value.peakAdditionalRssBytes = Math.max(value.peakAdditionalRssBytes, memory.rss - BASELINE.rssBytes, 0);
      value.diagnostics = { heapUsed: memory.heapUsed, external: memory.external, arrayBuffers: memory.arrayBuffers };
      return value;
    },
  };
}

const absent = () => ({
  acceptance: "failed",
  targetAcceptance: "blocked",
  reasons: ["operator-policy-missing"],
});

module.exports = { observation, absent };

const { BSON } = require("mongodb");
const { createHash, createPublicKey, verify } = require("node:crypto");
const { createControl } = require("./control");
const MiB = 1048576;
const backing = new WeakMap();
const localOwners = new Set();
const HTTP_CAPACITY = Symbol("patients-http-capacity");
const order = (value) =>
  Array.isArray(value)
    ? value.map(order)
    : value && value.constructor === Object
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, order(value[key])])
        )
      : value;
const digest = (value) =>
  createHash("sha256")
    .update(BSON.serialize(order(value)))
    .digest("hex");
const boundedId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
function allowance(value) {
  if (
    !value ||
    ![value.allocation, value.existingPeak, value.reservations, value.totalLimit].every(nonnegative) ||
    Math.min(value.allocation, value.totalLimit) - value.existingPeak - value.reservations <= 0
  )
    throw new Error("Invalid capacity headroom evidence");
  return Math.min(value.allocation, value.totalLimit) - value.existingPeak - value.reservations;
}
function resolve(config, db) {
  if (!config) return { key: "unverified", reasons: ["operator-policy-missing"] };
  const evidence = config.evidence;
  if (!Buffer.isBuffer(evidence?.manifest) || !Buffer.isBuffer(evidence.signature) || evidence.manifest.length > 65536)
    throw new Error("Missing capacity operator evidence");
  const policy = BSON.deserialize(evidence.manifest);
  const authority = config.trustedOperators?.[policy.authority];
  const key = authority?.publicKey;
  if (
    !key ||
    authority.scope !== policy.scope ||
    !authority.deployments?.includes(policy.deployment?.id) ||
    !verify(null, evidence.manifest, key, evidence.signature)
  )
    throw new Error("Untrusted capacity policy");
  if (
    policy.version !== "patients-capacity-v1" ||
    !["isolated-fixture", "deployment"].includes(policy.scope) ||
    digest(policy.deployment) !== digest(config.binding) ||
    policy.deployment.runtime !== process.version ||
    policy.deployment.platform !== process.platform ||
    policy.deployment.arch !== process.arch ||
    policy.deployment.driver !== require("mongodb/package.json").version ||
    policy.deployment.codec !== require("roaring/package.json").version
  )
    throw new Error("Incompatible capacity deployment");
  if (policy.scope === "isolated-fixture" && !db.databaseName.startsWith("patients_contract_"))
    throw new Error("Fixture capacity policy cannot apply to a target database");
  if (policy.scope === "deployment" && policy.topology?.database?.name !== db.databaseName)
    throw new Error("Capacity database deployment binding mismatch");
  const validity = policy.validity;
  if (
    !(validity?.kind === "revision" && validity.revision === policy.deployment.revision) &&
    !(
      validity?.kind === "window" &&
      Number.isFinite(validity.from) &&
      Number.isFinite(validity.until) &&
      validity.from <= Date.now() &&
      Date.now() <= validity.until
    )
  )
    throw new Error("Expired or missing capacity applicability");
  if (
    !boundedId(policy.evidence?.reference) ||
    !/^[a-f0-9]{64}$/.test(policy.evidence.sha256) ||
    !Number.isFinite(Date.parse(policy.evidence.from)) ||
    !Number.isFinite(Date.parse(policy.evidence.through)) ||
    Date.parse(policy.evidence.from) >= Date.parse(policy.evidence.through)
  )
    throw new Error("Missing capacity peak provenance");
  const topology = policy.topology;
  if (
    !Array.isArray(topology?.processes) ||
    !topology.processes.length ||
    topology.processes.length > 64 ||
    !Array.isArray(topology.volumes) ||
    !topology.volumes.length ||
    topology.volumes.length > 32 ||
    !Array.isArray(policy.workloads) ||
    !policy.workloads.length ||
    policy.workloads.length > 32 ||
    !Array.isArray(policy.domains) ||
    !policy.domains.length ||
    policy.domains.length > 32
  )
    throw new Error("Incomplete capacity topology or workload");
  const selected = topology.processes.find(
    (item) =>
      item.id === config.processId &&
      item.pid === ACTOR.pid &&
      item.startedAt === ACTOR.startedAt &&
      item.host === ACTOR.host
  );
  if (
    !selected ||
    topology.processes.some(
      (item) =>
        !boundedId(item.id) ||
        !Number.isSafeInteger(item.pid) ||
        !Number.isSafeInteger(item.startedAt) ||
        !boundedId(item.host) ||
        !Array.isArray(item.roles) ||
        !item.roles.length ||
        item.roles.some((role) => !["api", "builder"].includes(role))
    ) ||
    new Set(topology.processes.map((item) => item.id)).size !== topology.processes.length
  )
    throw new Error("Capacity process inventory does not match actual actor");
  const domains = policy.domains.map((domain) => {
    if (!boundedId(domain.id) || !["host", "service", "volume"].includes(domain.kind))
      throw new Error("Invalid capacity domain");
    if (
      (["host", "service"].includes(domain.kind) && (!domain.ram || !domain.cpu)) ||
      (domain.kind === "volume" && !domain.disk)
    )
      throw new Error("Missing mandatory capacity RAM/CPU/disk domain");
    const limits = { id: domain.id, kind: domain.kind };
    if (domain.ram) {
      const h = allowance(domain.ram);
      Object.assign(limits, {
        apiBytes: Math.min(256 * MiB, Math.floor(h / 4)),
        builderBytes: Math.min(512 * MiB, Math.floor(h / 4)),
        databaseBytes: Math.floor(h / 4),
        combinedBytes: Math.floor((3 * h) / 4),
      });
    }
    if (domain.disk) limits.diskBytes = Math.floor((allowance(domain.disk) * 4) / 5);
    if (domain.cpu) {
      if (!boundedId(domain.cpu.unit) || !Number.isSafeInteger(domain.cpu.windowMS) || domain.cpu.windowMS <= 0)
        throw new Error("Missing capacity CPU units/window");
      limits.cpu = allowance(domain.cpu) / 2;
    }
    if (!Array.isArray(domain.io) || !domain.io.length || domain.io.length > 16)
      throw new Error("Missing controlling capacity IO metrics");
    limits.io = Object.fromEntries(
      domain.io.map((metric) => {
        if (
          !boundedId(metric.id) ||
          !boundedId(metric.unit) ||
          !Number.isSafeInteger(metric.windowMS) ||
          metric.windowMS <= 0
        )
          throw new Error("Missing controlling capacity IO units/window");
        return [metric.id, allowance(metric) / 2];
      })
    );
    return limits;
  });
  const ids = new Set(domains.map((item) => item.id));
  const subjects = [...topology.processes, topology.database, ...topology.volumes];
  if (
    ids.size !== domains.length ||
    subjects.some(
      (item) => !item || !Array.isArray(item.domains) || !item.domains.length || item.domains.some((id) => !ids.has(id))
    ) ||
    subjects
      .slice(0, topology.processes.length + 1)
      .some((item) => !item.domains.some((id) => domains.find((d) => d.id === id)?.apiBytes)) ||
    !topology.volumes.every((item) => item.domains.some((id) => domains.find((d) => d.id === id)?.diskBytes)) ||
    !["source", "database", "logs", "temporary"].every((purpose) =>
      topology.volumes.some((item) => item.purposes?.includes(purpose))
    )
  )
    throw new Error("Incomplete capacity resource applicability");
  const operatorKey = (key.type === "public" ? key : createPublicKey(key)).export({ type: "spki", format: "der" });
  return { policy, selected, limits: domains, operatorKey, key: digest({ policy, operatorKey }), reasons: [] };
}

function totals(owners) {
  const allocations = new Map();
  const result = { api: 0, builder: 0, serialized: 0, retainedSerialized: 0, decoded: 0, nativeHandles: 0 };
  for (const owner of owners) {
    result[owner.role] += owner.workspaceBytes;
    result.serialized += owner.serializedWindowBytes ?? 0;
    result.nativeHandles += owner.nativeHandles;
    for (const item of owner.allocations) if (!allocations.has(item.id)) allocations.set(item.id, item);
  }
  for (const item of allocations.values()) {
    if (item.kind === "serialized") result.retainedSerialized += item.bytes;
    if (item.kind === "decoded") result.decoded += item.bytes;
  }
  return result;
}

function createCapacity({ db, config }) {
  // Policy is verified from composition-root trust, not an HTTP caller or a
  // source producer. Failure happens before any model work is admitted.
  const resolved = resolve(config, db);
  const control = createControl({ db });
  const source = (manifest, producers) => {
    const producer = producers?.[manifest.producer];
    if (
      producer &&
      resolved.operatorKey &&
      (producer.type === "public" ? producer : createPublicKey(producer))
        .export({ type: "spki", format: "der" })
        .equals(resolved.operatorKey)
    )
      throw new Error("Source producer is not an independent capacity authority");
    if (
      resolved.policy &&
      !resolved.policy.workloads.some(
        (item) =>
          item.sha256 === manifest.sha256 &&
          item.sourceVersion === manifest.sourceVersion &&
          item.domain === manifest.domain?.revision &&
          digest(item.history) === digest(manifest.history)
      )
    )
      throw new Error("Capacity workload applicability changed");
  };
  return {
    key: resolved.key,
    source,
    async begin(budget, role, { pin, worker, generationId, dependents = new Set() } = {}) {
      if (resolved.selected && !resolved.selected.roles.includes(role))
        throw new Error("Capacity role is inapplicable to this process");
      for (const limit of resolved.limits ?? []) {
        if (!resolved.selected.domains.includes(limit.id)) continue;
        budget.limits.maxAdditionalRssBytes = Math.min(
          budget.limits.maxAdditionalRssBytes,
          (role === "api" ? limit.apiBytes : limit.builderBytes) ?? Infinity
        );
      }
      for (const limit of resolved.limits ?? []) {
        if (budget.limits.maxStorageBytes && limit.diskBytes)
          budget.limits.maxStorageBytes = Math.min(budget.limits.maxStorageBytes, limit.diskBytes);
      }
      const id = randomUUID(),
        dependencies = new Set(),
        allocations = new Map(),
        credits = new Map();
      const observations = new Set();
      let nativeHandles = 0,
        peakHandles = 0,
        serializedWindow = 0,
        ended = false,
        active = false,
        sequence = Promise.resolve(),
        lastFlushed;
      let workspace = resolved.policy?.admission?.[`${role}Bytes`] ?? 4 * MiB;
      if (!Number.isSafeInteger(workspace) || workspace <= 0 || workspace > budget.limits.maxAdditionalRssBytes)
        throw new Error("Invalid capacity workspace admission");
      const reasons = new Set(resolved.reasons);
      const peaks = {
        apiBytes: 0,
        builderBytes: 0,
        serializedBytes: 0,
        retainedSerializedBytes: 0,
        decodedBytes: 0,
        nativeHandles: 0,
      };
      const observed = {};
      const ownMemory = () => [...allocations.values()].reduce((sum, item) => sum + item.bytes, 0);
      const serializedNeed = () =>
        [...allocations.values()]
          .filter((item) => item.kind === "serialized" && (!item.credit || !credits.has(item.credit)))
          .reduce((sum, item) => sum + item.bytes, 0) +
        [...credits.values()].reduce((sum, item) => sum + item.bytes, 0);
      const descriptor = (physical = false) => ({
        id,
        role,
        worker,
        generationId,
        pin: pin?.id,
        state: "live",
        actor: ACTOR,
        processId: config?.processId ?? `unverified:${process.pid}:${ACTOR.startedAt}`,
        domains: resolved.selected?.domains ?? [],
        dependsOn: [...dependencies],
        memoryLimit: budget.limits.maxAdditionalRssBytes,
        workspaceBytes: workspace,
        serializedWindowBytes: serializedWindow,
        allocations: physical
          ? [...allocations.values()]
              .filter((item) => item.kind === "serialized")
              .map(({ references: _references, credit: _credit, ...item }) => item)
          : [],
        nativeHandles: peakHandles,
      });
      function state() {
        return {
          policyKey: resolved.key,
          scope: resolved.policy?.scope ?? "unverified",
          fixedLimits: resolved.limits ?? [],
          acceptance: reasons.size ? "failed" : "evidence-verified",
          targetAcceptance:
            resolved.policy?.scope === "deployment" && reasons.size === 0 ? "evidence-verified" : "blocked",
          reasons: [...reasons].sort().slice(0, 32),
          ownershipPeaks: peaks,
          observed,
          limitations: [
            "workspace-and-serialized-windows-are-reservations",
            "retained-backing-samples-are-local-and-deduplicated",
            "native-and-heap-overlap-process-rss",
            "sampling-is-not-peak-proof",
          ],
        };
      }
      function checkOwners(owners) {
        const aggregate = totals(owners);
        if (aggregate.serialized > 8 * MiB || aggregate.api > 256 * MiB || aggregate.builder > 512 * MiB)
          throw new Error("Aggregate retained capacity budget exceeded");
        const own = totals([descriptor()]);
        if (own[role] > Math.min((role === "api" ? 128 : 512) * MiB, budget.limits.maxAdditionalRssBytes))
          throw new Error("Response or Builder retained capacity exceeded");
        for (const owner of owners.filter((item) => item.role === "api")) {
          const dependent = totals(owners.filter((item) => item.id === owner.id || owner.dependsOn?.includes(item.id)));
          if (dependent.api > Math.min(128 * MiB, owner.memoryLimit))
            throw new Error("Response including shared work exceeds capacity");
        }
        for (const limit of resolved.limits ?? []) {
          const subtotal = totals(owners.filter((owner) => owner.domains.includes(limit.id)));
          if (
            subtotal.api > (limit.apiBytes ?? Infinity) ||
            subtotal.builder > (limit.builderBytes ?? Infinity) ||
            subtotal.api + subtotal.builder > (limit.combinedBytes ?? Infinity)
          )
            throw new Error("Derived capacity RAM budget exceeded");
        }
        return aggregate;
      }
      function record(aggregate) {
        peaks.decodedBytes = Math.max(
          peaks.decodedBytes,
          [...allocations.values()].filter((item) => item.kind === "decoded").reduce((sum, item) => sum + item.bytes, 0)
        );
        peaks.apiBytes = Math.max(peaks.apiBytes, aggregate.api);
        peaks.builderBytes = Math.max(peaks.builderBytes, aggregate.builder);
        peaks.serializedBytes = Math.max(peaks.serializedBytes, aggregate.serialized);
        peaks.retainedSerializedBytes = Math.max(peaks.retainedSerializedBytes, aggregate.retainedSerialized);
        peaks.decodedBytes = Math.max(peaks.decodedBytes, aggregate.decoded);
        peaks.nativeHandles = Math.max(peaks.nativeHandles, aggregate.nativeHandles);
      }
      async function sample() {
        budget.check();
        if (!resolved.policy) return;
        if (resolved.policy.validity.kind === "window" && Date.now() > resolved.policy.validity.until)
          throw new Error("Capacity policy expired during work");
        let measurements;
        if (config.observe) {
          const requestedAt = Date.now();
          let packet;
          try {
            const timeoutMS = budget.check();
            const controller = new AbortController();
            let timer;
            const pending = Promise.resolve().then(() =>
              config.observe({ policyKey: resolved.key, requestedAt, signal: controller.signal })
            );
            observations.add(pending);
            void pending.then(
              () => observations.delete(pending),
              () => observations.delete(pending)
            );
            try {
              packet = await Promise.race([
                pending,
                new Promise((_, reject) => {
                  timer = setTimeout(() => {
                    controller.abort();
                    const error = new Error("Capacity observation deadline exceeded");
                    error.observationTimeout = true;
                    reject(error);
                  }, timeoutMS);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
            if (
              !Buffer.isBuffer(packet?.manifest) ||
              !Buffer.isBuffer(packet.signature) ||
              packet.manifest.length > 65536
            )
              throw new Error("Missing observer seal");
            const record = BSON.deserialize(packet.manifest);
            const collector = config.trustedCollectors?.[record.authority];
            const key = collector?.publicKey;
            const rule = resolved.policy.observers?.find(
              (item) => item.authority === record.authority && item.mechanism === record.mechanism
            );
            const receivedAt = Date.now();
            if (
              !key ||
              collector.scope !== resolved.policy.scope ||
              !verify(null, packet.manifest, key, packet.signature) ||
              record.policyKey !== resolved.key ||
              !rule ||
              !Number.isSafeInteger(rule.maximumLagMS) ||
              rule.maximumLagMS < 0 ||
              !Number.isSafeInteger(rule.maximumGapMS) ||
              rule.maximumGapMS < 0 ||
              !Number.isFinite(record.from) ||
              !Number.isFinite(record.through) ||
              record.from > record.through ||
              record.from > budget.metrics.observation.baseline.at ||
              record.through > receivedAt ||
              requestedAt - record.through > rule.maximumLagMS ||
              !Number.isFinite(record.maximumGapMS) ||
              record.maximumGapMS < 0 ||
              record.maximumGapMS > rule.maximumGapMS ||
              !Array.isArray(record.domains)
            )
              throw new Error("Inapplicable observer proof");
            measurements = record;
            if (record.scope !== "representative-complete-peaks" || collector.scope !== "deployment")
              reasons.add("observer-peaks-not-representative");
          } catch (error) {
            reasons.add("observer-proof-unverified");
            if (error?.observationTimeout) throw error;
          }
        }
        for (const domain of resolved.policy.domains) {
          const values = measurements?.domains?.find((item) => item.id === domain.id);
          const limits = resolved.limits.find((item) => item.id === domain.id);
          if (domain.ram) {
            // Aggregate process/role RSS cannot establish an isolated response's
            // additional peak. This attribution must come from the separately
            // trusted collector and its operator-approved measurement mechanism.
            const response = values?.ram?.response;
            if (
              !response ||
              !nonnegative(response.additional) ||
              response.unit !== "bytes" ||
              response.attribution !== "isolated-response-additional-peak" ||
              response.coverage !== "complete-peak" ||
              !boundedId(response.evidence)
            )
              reasons.add(`metric-unavailable:${domain.id}:response`);
            else {
              const key = `${domain.id}:response`;
              observed[key] = {
                ...response,
                additional: Math.max(observed[key]?.additional ?? 0, response.additional),
                scope: measurements.scope,
              };
              if (
                response.additional >
                Math.min(128 * MiB, role === "api" ? budget.limits.maxAdditionalRssBytes : Infinity)
              )
                throw new Error("Observed capacity response RAM budget exceeded");
            }
          }
          for (const metric of ["ram", "disk", "cpu", ...domain.io.map((item) => `io:${item.id}`)]) {
            const rule = metric.startsWith("io:")
              ? domain.io.find((item) => item.id === metric.slice(3))
              : domain[metric];
            if (!rule) continue;
            const value = values?.[metric];
            if (
              !value ||
              !nonnegative(value.additional) ||
              !nonnegative(value.total) ||
              value.total < value.additional ||
              (rule.unit && (value.unit !== rule.unit || value.windowMS !== rule.windowMS))
            ) {
              reasons.add(`metric-unavailable:${domain.id}:${metric}`);
              continue;
            }
            if (value.coverage !== "complete-peak" || !boundedId(value.evidence))
              reasons.add(`metric-peak-unverified:${domain.id}:${metric}`);
            const key = `${domain.id}:${metric}`;
            const maximum = observed[key] ?? { additional: 0, total: 0 };
            observed[key] = {
              additional: Math.max(maximum.additional, value.additional),
              total: Math.max(maximum.total, value.total),
              unit: rule.unit ?? "bytes",
              windowMS: rule.windowMS ?? null,
              coverage: value.coverage,
              evidence: value.evidence,
              scope: measurements.scope,
            };
            const cap =
              metric === "disk"
                ? limits.diskBytes
                : metric === "ram"
                  ? limits.combinedBytes
                  : metric === "cpu"
                    ? limits.cpu
                    : limits.io[metric.slice(3)];
            if (value.additional > cap || value.total > rule.totalLimit)
              throw new Error("Observed capacity resource budget exceeded");
            if (metric === "ram")
              for (const [name, derivedCeiling] of [
                ["api", limits.apiBytes],
                ["builder", limits.builderBytes],
                ["database", limits.databaseBytes],
              ]) {
                const ceiling =
                  name === "builder" && role === "builder"
                    ? Math.min(derivedCeiling, budget.limits.maxAdditionalRssBytes)
                    : derivedCeiling;
                if (!nonnegative(value[name])) reasons.add(`metric-unavailable:${domain.id}:${name}`);
                else if (value[name] > ceiling) throw new Error("Observed capacity role RAM budget exceeded");
              }
          }
        }
        budget.check();
      }
      const account = {
        descriptor,
        state,
        id,
        settlementProof(proof) {
          if (!observations.size) return proof;
          reasons.add("observation-termination-unverified");
          return { safe: false, proof: "capacity-observation-work-unsettled" };
        },
        currentBytes: ownMemory,
        depend(other) {
          dependencies.add(other);
        },
        async link(other) {
          dependencies.add(other.id);
          await account.flush();
        },
        async admitMemory(bytes) {
          if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid capacity memory admission");
          if (bytes <= workspace) return;
          workspace = Math.max(
            bytes,
            Math.min(budget.limits.maxAdditionalRssBytes, Math.ceil(bytes / (4 * MiB)) * 4 * MiB)
          );
          await account.flush();
        },
        async reserveSerialized(bytes) {
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > budget.limits.maxSerializedBytes)
            throw new Error("Serialized capacity admission exceeded");
          const token = randomUUID();
          credits.set(token, { id: token, kind: "serialized", bytes: Math.max(8192, bytes) });
          // Admission, including all other processes, commits before the caller
          // allocates a known buffer or dispatches a cursor batch.
          async function admitWindow() {
            const needed = serializedNeed();
            if (needed > serializedWindow) {
              serializedWindow = Math.ceil(needed / 65536) * 65536;
              await account.flush();
            } else {
              budget.check();
              account.check();
            }
          }
          try {
            await admitWindow();
          } catch (error) {
            credits.delete(token);
            throw error;
          }
          let released = false;
          return {
            hold(value) {
              return account.hold(value, "serialized", undefined, token);
            },
            async grow(bytes) {
              const entry = credits.get(token);
              if (entry && bytes > entry.bytes) {
                if (!Number.isSafeInteger(bytes) || bytes > budget.limits.maxSerializedBytes)
                  throw new Error("Serialized capacity admission exceeded");
                entry.bytes = bytes;
                await admitWindow();
              }
            },
            async release() {
              if (released) return;
              released = true;
              credits.delete(token);
              // The owner retains one admitted window for bounded local
              // subleases. Returning a settled row's unused credit cannot
              // require two coordinator CAS operations for every next().
              account.check();
            },
          };
        },
        hold(value, kind = "serialized", bytes, credit) {
          if (ended) throw new Error("Capacity lifetime has ended");
          let token;
          if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
            const base = value.buffer;
            if (!backing.has(base)) backing.set(base, randomUUID());
            token = backing.get(base);
            bytes = base.byteLength;
          } else {
            token = randomUUID();
            bytes ??= BSON.calculateObjectSize({ value }) * 4;
          }
          if (
            !Number.isSafeInteger(bytes) ||
            bytes < 0 ||
            allocations.size >= 4096 ||
            (credit && bytes > credits.get(credit)?.bytes)
          )
            throw new Error("Capacity allocation inventory or admission exceeded");
          const entry = allocations.get(token);
          if (entry) entry.references += 1;
          else allocations.set(token, { id: token, bytes, kind, credit, references: 1 });
          if (ownMemory() > workspace) {
            if (!entry) allocations.delete(token);
            else entry.references -= 1;
            reasons.add("retained-resource-overrun");
            throw new Error("Retained capacity exceeds admitted workspace");
          }
          if (
            serializedNeed() > serializedWindow ||
            [...allocations.values()]
              .filter((item) => item.kind === "serialized")
              .reduce((sum, item) => sum + item.bytes, 0) > serializedWindow
          )
            throw new Error("Serialized backing exceeds admitted window");
          try {
            const committedLocal = checkOwners(
              [...localOwners]
                .filter((owner) => owner.database === db.databaseName)
                .map((owner) => owner.descriptor(true))
            );
            record(committedLocal);
          } catch (error) {
            reasons.add("retained-resource-overrun");
            throw error;
          }
          let released = false;
          return () => {
            if (released) return;
            released = true;
            const item = allocations.get(token);
            if (item && --item.references === 0) allocations.delete(token);
          };
        },
        settledPhase() {
          credits.clear();
          serializedWindow = 0;
        },
        native(delta) {
          nativeHandles += delta;
          peakHandles = Math.max(peakHandles, nativeHandles);
        },
        check() {
          checkOwners(
            [...localOwners]
              .filter((owner) => owner.database === db.databaseName)
              .map((owner) => owner.descriptor(true))
          );
        },
        database: db.databaseName,
        async flush() {
          const operation = sequence.then(async () => {
            if (ended) return;
            account.check();
            if (!active) {
              record(
                totals(
                  [...localOwners].filter((item) => item.database === db.databaseName).map((item) => item.descriptor())
                )
              );
              await sample();
              return;
            }
            const next = descriptor(),
              fingerprint = digest(next);
            if (fingerprint !== lastFlushed) {
              const committed = await control.change(budget, (document) => {
                const previous = document.capacity ?? { policyKey: resolved.key, owners: [] };
                if (previous.policyKey !== resolved.key && previous.owners.length)
                  throw new Error("Capacity policy changed while work remains owned");
                const owners = previous.owners.filter((item) => item.id !== id);
                for (const parent of dependents) {
                  const current = owners.find((item) => item.id === parent.id);
                  if (current && !current.dependsOn.includes(id)) current.dependsOn.push(id);
                }
                owners.push(next);
                if (owners.length > 128) throw new Error("Capacity owner inventory overflow");
                const aggregate = checkOwners(owners);
                document.capacity = { policyKey: resolved.key, owners };
                return aggregate;
              });
              record(committed);
              lastFlushed = fingerprint;
            }
            // Even collectors run only after the owner's durable admission.
            // A timed-out collector remains attached to this owner until real
            // settlement; deadline expiry never turns it into no work.
            await sample();
          });
          sequence = operation.catch(() => {});
          try {
            await operation;
          } catch (error) {
            reasons.add("capacity-guard-failed");
            budget.metrics.capacity = state();
            throw error;
          }
          budget.metrics.capacity = state();
        },
        async finish(proof) {
          await sequence;
          proof = account.settlementProof(proof);
          if (ended) return proof;
          if (active)
            await control.change(budget.settlement ?? budget, (document) => {
              if (!document.capacity) return true;
              if (proof.safe) document.capacity.owners = document.capacity.owners.filter((item) => item.id !== id);
              else {
                const owner = document.capacity.owners.find((item) => item.id === id);
                if (owner) owner.state = "suspect";
              }
              return true;
            });
          if (proof.safe) {
            ended = true;
            allocations.clear();
            credits.clear();
            localOwners.delete(account);
          } else reasons.add("termination-unverified");
          budget.metrics.capacity = state();
          return proof;
        },
      };
      for (const parent of dependents) parent.depend(id);
      localOwners.add(account);
      budget.capacity = account;
      budget.metrics.capacity = state();
      try {
        active = !!pin || role === "builder";
        if (active) active = await control.exists(budget);
        await account.flush();
        return account;
      } catch (error) {
        // No model dispatch occurred. An uncertain coordination outcome remains
        // owned; a verified rejected admission did not acquire any resources.
        if (!lastFlushed && error.controlOutcome !== "unknown" && !observations.size) {
          localOwners.delete(account);
          ended = true;
        }
        error.resources = budget.snapshot();
        throw error;
      }
    },
  };
}
module.exports = { observation, absent, createCapacity, digest, ACTOR, HTTP_CAPACITY };

// Private HTTP handoff. Model work can settle before res.json encodes its body;
// the physical output buffer stays owned until the actual response ends.
function responseCapacity(res) {
  let owner,
    proof,
    finished = false,
    closing;
  const releases = [],
    pending = new Set();
  const finish = () => {
    if (!owner || !proof || !finished) return;
    return (closing ??= (async () => {
      await Promise.allSettled(pending);
      for (const release of releases) release();
      await owner.finish(proof);
    })().catch(() => {
      /* Durable ownership remains if settlement is uncertain. */
    }));
  };
  for (const event of ["finish", "close"])
    res.once(event, () => {
      finished = true;
      void finish();
    });
  const original = res.json;
  res.json = function json(value) {
    if (!owner || res.statusCode >= 400) return original.call(this, value);
    const work = (async () => {
      if (res.destroyed || res.writableEnded) return res;
      // Existing controllers return plain JSON with the standard Express
      // serializer. A custom allocating replacer needs its own reviewed bound.
      if (res.app.get("json replacer") || res.app.get("json spaces"))
        throw new Error("Unsupported JSON capacity bound");
      const bsonBytes = BSON.calculateObjectSize({ value });
      const upper = Math.max(8192, bsonBytes * 6 + 128);
      await owner.admitMemory(owner.currentBytes() + bsonBytes * 4 + upper * 3 + 65536);
      const lease = await owner.reserveSerialized(upper);
      try {
        if (res.destroyed || res.writableEnded) return res;
        releases.push(owner.hold(value, "decoded", bsonBytes * 4));
        let text = JSON.stringify(value);
        if (res.app.get("json escape"))
          text = text.replace(/[<>&]/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026" })[c]);
        if (Buffer.byteLength(text) > upper) throw new Error("Encoded response exceeds admitted capacity");
        const stringReservation = owner.hold(null, "reservation", text.length * 2);
        let buffer;
        try {
          buffer = Buffer.allocUnsafeSlow(Buffer.byteLength(text));
          buffer.write(text, "utf8");
        } finally {
          stringReservation();
        }
        releases.push(lease.hold(buffer));
        await lease.release();
        if (res.destroyed || res.writableEnded) return res;
        if (!res.get("Content-Type")) res.type("json");
        return res.send(buffer);
      } finally {
        await lease.release();
      }
    })().catch(unavailable);
    pending.add(work);
    void work.then(
      () => {
        pending.delete(work);
        void finish();
      },
      () => {
        pending.delete(work);
        void finish();
      }
    );
    return work;
  };
  function unavailable() {
    if (res.destroyed || res.writableEnded) return res;
    if (res.headersSent) {
      res.destroy();
      return res;
    }
    require("./metadata").responseMetadata(res);
    res.status(503);
    return original.call(res, { status: false, message: "Read model unavailable" });
  }
  return {
    bind(value) {
      owner = value;
      void finish();
    },
    settle(value) {
      proof = value;
      void finish();
    },
  };
}
module.exports.responseCapacity = responseCapacity;

// Finite, measured layout facts. Collection samples deliberately do not claim
// device/log/transient index peaks or assign shared collection allocation to
// individual generations. The operator collector supplies those other facts.
async function aggregateOne(collection, pipeline, budget) {
  const cursor = collection.aggregate(pipeline, budget.options({ allowDiskUse: false }));
  try {
    return (await cursor.toArray())[0] ?? {};
  } finally {
    await cursor.close();
  }
}
async function rawInventory(raw, budget) {
  const values = await aggregateOne(
    raw,
    [
      {
        $group: {
          _id: null,
          records: { $sum: 1 },
          maxBsonBytes: { $max: { $bsonSize: "$$ROOT" } },
          firstDate: { $min: "$claim_date" },
          lastDate: { $max: "$claim_date" },
        },
      },
    ],
    budget
  );
  const count = async (field) =>
    (await aggregateOne(raw, [{ $group: { _id: `$${field}` } }, { $count: "count" }], budget)).count ?? 0;
  return {
    records: values.records ?? 0,
    maxBsonBytes: values.maxBsonBytes ?? 0,
    firstDate: values.firstDate ?? null,
    lastDate: values.lastDate ?? null,
    distinctPatientValues: await count("cid"),
    distinctHospitalValues: await count("hcode"),
    identityEquality: "mongo-group-original-bson",
  };
}
async function summaryInventory(summaries, budget) {
  const { CATEGORIES } = require("./schema");
  const expressions = CATEGORIES.flatMap(({ field }, index) => [
    [`n${index}`, { $sum: { $cond: [{ $isArray: `$${field}` }, { $size: `$${field}` }, 0] } }],
    [`d${index}`, { $sum: { $cond: [{ $isArray: `$${field}` }, { $size: { $setUnion: [`$${field}`] } }, 0] } }],
    [`invalid${index}`, { $sum: { $cond: [{ $isArray: `$${field}` }, 0, 1] } }],
  ]);
  const value = await aggregateOne(
    summaries,
    [
      {
        $group: {
          _id: null,
          hospitalDays: { $sum: 1 },
          maxBsonBytes: { $max: { $bsonSize: "$$ROOT" } },
          ...Object.fromEntries(expressions),
        },
      },
    ],
    budget
  );
  const geography = await aggregateOne(
    summaries,
    [
      {
        $group: {
          _id: Object.fromEntries(
            ["hcode", "area", "province", "district"].map((field) => [
              field,
              { type: { $type: `$${field}` }, value: `$${field}` },
            ])
          ),
        },
      },
      { $count: "count" },
    ],
    budget
  );
  return {
    hospitalDays: value.hospitalDays ?? 0,
    maxBsonBytes: value.maxBsonBytes ?? 0,
    typedGeographyPartitions: geography.count ?? 0,
    memberships: Object.fromEntries(
      CATEGORIES.map(({ id }, index) => [
        id,
        {
          expanded: value[`n${index}`] ?? 0,
          deduplicated: value[`d${index}`] ?? 0,
          nonArrayRows: value[`invalid${index}`] ?? 0,
        },
      ])
    ),
  };
}
async function outputInventory(db, generationId, budget) {
  const { COLLECTIONS, CATEGORIES } = require("./schema");
  const dictionary = {};
  for await (const row of db
    .collection(COLLECTIONS.identity)
    .aggregate([{ $match: { generationId } }, { $group: { _id: "$kind", count: { $sum: 1 } } }], budget.options()))
    dictionary[row._id] = row.count;
  const memberships = {};
  const ids = CATEGORIES.map(({ id }) => id).concat(["CARD", "HOSPITAL"]);
  const counts = await aggregateOne(
    db.collection(COLLECTIONS.daily),
    [
      { $match: { generationId } },
      { $group: { _id: null, ...Object.fromEntries(ids.map((id) => [id, { $sum: `$members.${id}.cardinality` }])) } },
    ],
    budget
  );
  for (const id of ids) memberships[id] = counts[id] ?? 0;
  const bitmap = await aggregateOne(
    db.collection(COLLECTIONS.chunks),
    [
      { $match: { generationId } },
      {
        $group: {
          _id: null,
          chunks: { $sum: 1 },
          serializedPayloadBytes: { $sum: "$length" },
          storedMemberships: { $sum: "$popcount" },
          largestPayloadBytes: { $max: "$length" },
        },
      },
    ],
    budget
  );
  const partitions = {};
  for (const key of ["daily", "months", "scopes", "monthScopes", "dateMonths", "dateMonthScopes", "snapshots"])
    partitions[key] = await db.collection(COLLECTIONS[key]).countDocuments({ generationId }, budget.options());
  return { dictionary, memberships, partitions, bitmap };
}
const sourceRegistries = new WeakMap();
function mergeSource(previous, current) {
  const logicalBytes = Math.max(previous?.logicalBytes ?? previous?.bytes ?? 0, current.logicalBytes ?? current.bytes);
  const known = [previous?.allocatedBytes, current.allocatedBytes].filter(Number.isSafeInteger);
  const allocatedBytes = known.length ? Math.max(...known) : null;
  const allocationUnknown =
    !!previous?.allocationUnknown || !Number.isSafeInteger(current.allocatedBytes) || !!current.allocationUnknown;
  return {
    backing: current.backing,
    logicalBytes,
    allocatedBytes,
    bytes: Math.max(previous?.bytes ?? 0, current.bytes, logicalBytes, allocatedBytes ?? 0),
    allocationUnknown,
    coverage: allocationUnknown
      ? "allocated-file-blocks-incomplete"
      : "retained-file-allocation-high-water-not-volume-peaks",
  };
}
async function rememberSources(db, observed, budget) {
  const cached = sourceRegistries.get(budget);
  if (
    cached &&
    observed.every((item) => {
      const previous = cached.find((file) => file.backing === item.backing);
      return previous && digest(previous) === digest(mergeSource(previous, item));
    })
  )
    return { files: cached, wrote: false };
  const control = createControl({ db: require("./lifetime").rawDb(db) });
  if (!(await control.exists(budget))) return { files: observed, wrote: false };
  await control.change(budget, (document) => {
    const files = new Map((document.retainedSourceFiles?.files ?? []).map((item) => [item.backing, item]));
    for (const item of observed) files.set(item.backing, mergeSource(files.get(item.backing), item));
    if (files.size > 64) throw new Error("Retained source backing inventory overflow");
    document.retainedSourceFiles = { version: "retained-source-files-v1", files: [...files.values()] };
    return { retainedSourceBackings: files.size };
  });
  const files = (await control.read(budget)).retainedSourceFiles.files;
  sourceRegistries.set(budget, files);
  return { files, wrote: true };
}
async function storageInventory(db, source, budget, { full = false, reserveRun = false } = {}) {
  const { COLLECTIONS } = require("./schema");
  const names = await db.listCollections({}, budget.options({ nameOnly: true })).toArray();
  const selected = names.filter(
    ({ name }) =>
      Object.values(COLLECTIONS).includes(name) ||
      name.startsWith("patients_stage_") ||
      ["patients_model_control", "patients_recovery_journal", "patients_refresh_runs"].includes(name)
  );
  if (selected.length > 256) throw new Error("Bounded capacity collection inventory exceeded");
  const collections = [];
  let allocated = 0;
  for (const { name } of selected) {
    const stats = await db.command({ collStats: name });
    if (![stats.storageSize, stats.totalIndexSize, stats.size, stats.count].every(nonnegative))
      throw new Error("Capacity collection observation unavailable");
    collections.push({
      name,
      documents: stats.count,
      dataBytes: stats.storageSize,
      indexBytes: stats.totalIndexSize,
      logicalBsonBytes: stats.size,
      indexes: stats.nindexes,
    });
    allocated += stats.storageSize + stats.totalIndexSize;
  }
  const transports = new Map();
  if (source?.transport) transports.set(source.transport.backing, source.transport);
  const generations = [];
  for await (const descriptor of db
    .collection(COLLECTIONS.generations)
    .find({}, budget.options({ projection: { "resources.ledger.transport": 1 } }))) {
    const transport = descriptor.resources?.ledger?.transport;
    if (transport) transports.set(transport.backing, mergeSource(transports.get(transport.backing), transport));
    if (full) {
      let total = 0;
      const layout = {};
      for (const name of Object.values(COLLECTIONS)) {
        const match = name === COLLECTIONS.generations ? { _id: descriptor._id } : { generationId: descriptor._id };
        const item = await aggregateOne(
          db.collection(name),
          [
            { $match: match },
            {
              $group: {
                _id: null,
                documents: { $sum: 1 },
                logicalBsonBytes: { $sum: { $bsonSize: "$$ROOT" } },
                maxBsonBytes: { $max: { $bsonSize: "$$ROOT" } },
              },
            },
          ],
          budget
        );
        delete item._id;
        layout[name] = {
          documents: item.documents ?? 0,
          logicalBsonBytes: item.logicalBsonBytes ?? 0,
          maxBsonBytes: item.maxBsonBytes ?? 0,
        };
        total += layout[name].logicalBsonBytes;
      }
      generations.push({ generationId: descriptor._id, logicalBsonBytes: total, collections: layout });
    }
  }
  const registry = await rememberSources(db, [...transports.values()], budget);
  const retainedSources = registry.files;
  if (registry.wrote) {
    // The independent registry itself remains in the bounded control document
    // after generation deletion and policy replacement. Charge its actual new
    // allocation as well as every known producer-owned source backing.
    const stats = await db.command({ collStats: "patients_model_control" });
    const entry = collections.find((item) => item.name === "patients_model_control");
    if (!entry || ![stats.storageSize, stats.totalIndexSize, stats.size, stats.count].every(nonnegative))
      throw new Error("Retained source registry storage observation unavailable");
    allocated += stats.storageSize + stats.totalIndexSize - entry.dataBytes - entry.indexBytes;
    Object.assign(entry, {
      documents: stats.count,
      dataBytes: stats.storageSize,
      indexBytes: stats.totalIndexSize,
      logicalBsonBytes: stats.size,
      indexes: stats.nindexes,
    });
  }
  const sourceBytes = retainedSources.reduce((sum, item) => sum + item.bytes, 0);
  const inFlightRunReservation = reserveRun ? 65536 : 0;
  const bytes = allocated + sourceBytes + inFlightRunReservation;
  budget.metrics.peakStorageBytes = Math.max(budget.metrics.peakStorageBytes ?? 0, bytes);
  budget.metrics.storage = {
    coverage: "retained-collection-samples-not-volume-peaks",
    retainedCollectionBytes: allocated,
    retainedSourceBytes: sourceBytes,
    sources: retainedSources,
    sourceRetention: "producer-owned-retained-until-independent-deletion-proof",
    inFlightRunReservation,
    collections,
    ...(full ? { generations } : {}),
    unavailable: [
      "database-transient-memory",
      "aggregation-index-spill-scratch",
      "journal-log-temp-volume-peaks",
      ...(retainedSources.some((item) => item.allocationUnknown || !Number.isSafeInteger(item.allocatedBytes))
        ? ["source-file-allocated-blocks"]
        : []),
    ],
    attribution: "shared-physical-collection-allocation-once; per-generation-BSON-is-logical-and-not-added-again",
  };
  budget.storage(bytes);
  return budget.metrics.storage;
}
module.exports.rawInventory = rawInventory;
module.exports.summaryInventory = summaryInventory;
module.exports.outputInventory = outputInventory;
module.exports.storageInventory = storageInventory;
