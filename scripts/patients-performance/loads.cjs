const { createHash, randomUUID } = require("node:crypto");
const { performance: monotonicClock } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { compareResponses, summarizeAttempts } = require("./compare.cjs");
const { PARTS, BASELINE_REVISION } = require("./contract-fixture.cjs");
const { REQUIRED_FAMILIES } = require("./cases.cjs");

const ROOT = path.resolve(__dirname, "../..");
const LIMITS = Object.freeze({
  artifactBytes: 8 * 1048576,
  requestBytes: 65536,
  conditions: 512,
  attemptRecordBytes: 256 * 1024,
  finalReserveBytes: 512 * 1024,
});
const SUPPLEMENTAL = [
  "typed-bson-collation",
  "all-fifteen-bindings",
  "independent-card-services-and-hospitals",
  "exact-expense-policy",
  "snapshot-source-provenance",
  "full-raw-corrections-and-deletions",
  "same-cut-recovery",
  "concurrent-generation-lifetime",
  "full-target-workload",
  "actual-page-and-visible-freshness",
];
const REQUIRED_HEADERS = [
  "content-type",
  "cache-control",
  "x-ncd-source-cut",
  "x-ncd-data-state",
  "access-control-expose-headers",
  "access-control-allow-origin",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const tokenSet = (value) =>
  value === null
    ? null
    : String(value)
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .sort();
const safeId = (value) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

function checkPlan(plan) {
  if (Buffer.byteLength(JSON.stringify(plan)) > 1048576) throw new Error("Load plan exceeds fixed input allowance");
  if (plan?.scope !== "isolated-fixture" || !["explore", "acceptance"].includes(plan.phase))
    throw new Error("Only explicit isolated fixture load plans are supported");
  if (!Number.isFinite(Date.parse(plan.clock)) || typeof plan.timeZone !== "string")
    throw new Error("Missing fixed calculation clock/timezone");
  new Intl.DateTimeFormat("en", { timeZone: plan.timeZone }).format();
  if (
    plan.reference?.baselineRevision !== BASELINE_REVISION ||
    plan.reference.repeated !== "exactly equal" ||
    !/^[a-f0-9]{64}$/.test(plan.reference.sha256)
  )
    throw new Error("Missing pinned stable independent reference");
  if (
    plan.source?.producer !== "synthetic-finite-domain-v1" ||
    plan.source?.dataset !== "raw" ||
    plan.source.complete !== true ||
    plan.source.consistency !== "producer-sealed-full-export" ||
    !/^[a-f0-9]{64}$/.test(plan.source.sha256) ||
    !plan.source.domain?.allSupportedHistory ||
    !plan.source.history
  )
    throw new Error("Missing immutable full fixture source binding");
  if (!safeId(plan.generation?.id) || !plan.generation.versions) throw new Error("Missing generation/policy identity");
  if (!Array.isArray(plan.conditions) || !plan.conditions.length || plan.conditions.length > LIMITS.conditions)
    throw new Error("Invalid bounded condition inventory");
  const ids = new Set();
  for (const condition of plan.conditions) {
    if (
      !safeId(condition.id) ||
      ids.has(condition.id) ||
      !safeId(condition.scenario) ||
      !["first", "later"].includes(condition.trial) ||
      !["live", "snapshot", "mixed"].includes(condition.routing)
    )
      throw new Error("Invalid or duplicate condition identity");
    ids.add(condition.id);
    if (typeof condition.requestBytes !== "string" || Buffer.byteLength(condition.requestBytes) > LIMITS.requestBytes)
      throw new Error("Missing exact bounded request bytes");
    JSON.parse(condition.requestBytes);
    if (!Array.isArray(condition.reference) || condition.reference.length !== PARTS.length)
      throw new Error("Each reference requires all six existing routes");
    for (let i = 0; i < PARTS.length; i++) {
      const reference = condition.reference[i];
      if (
        reference.route !== PARTS[i].route ||
        REQUIRED_HEADERS.some((name) => !Object.hasOwn(reference.headers ?? {}, name))
      )
        throw new Error("Incomplete exact route/header reference");
      compareResponses(reference, reference);
    }
  }
}

function compareLoad(condition, load) {
  let equal = true;
  const differences = [];
  for (let index = 0; index < PARTS.length; index++) {
    const actual = load.responses[index],
      expected = condition.reference[index];
    if (!actual?.parsed || actual.route !== expected.route) {
      equal = false;
      differences.push({ route: expected.route, kind: "missing-parsed-response" });
      continue;
    }
    let comparison;
    try {
      comparison = compareResponses(expected, actual);
    } catch {
      comparison = { equal: false, differences: [{ kind: "invalid-finite-json-response", path: "$body" }] };
    }
    if (!comparison.equal) equal = false;
    for (const difference of comparison.differences) {
      if (differences.length >= 64) break;
      differences.push({ route: expected.route, kind: difference.kind, path: difference.path.slice(0, 256) });
    }
    for (const [name, value] of Object.entries(expected.headers)) {
      const tokens = name === "access-control-expose-headers" || name === "vary";
      const same = tokens
        ? JSON.stringify(tokenSet(value)) === JSON.stringify(tokenSet(actual.headers?.[name] ?? null))
        : value === actual.headers?.[name];
      if (!same) {
        equal = false;
        if (differences.length < 64) differences.push({ route: expected.route, kind: "header", name });
      }
    }
  }
  return { equal, differences, boundedAt: 64 };
}

function artifactStore(outputDirectory) {
  let bytes = 0;
  const files = new Map();
  const bodies = new Map(),
    records = [];
  if (outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
    fs.mkdirSync(path.join(outputDirectory, "bodies"), { mode: 0o700 });
  }
  function write(name, value, { reserve = LIMITS.finalReserveBytes, append = false } = {}) {
    const wire = typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
    const size = Buffer.byteLength(wire);
    if (bytes + size + reserve > LIMITS.artifactBytes) throw new Error("Fixed load artifact budget exhausted");
    if (outputDirectory)
      fs.writeFileSync(path.join(outputDirectory, name), wire, { flag: append ? "a" : "wx", mode: 0o600 });
    const file = files.get(name) ?? { bytes: 0, digest: createHash("sha256") };
    file.bytes += size;
    file.digest.update(wire);
    files.set(name, file);
    bytes += size;
    return size;
  }
  return {
    write,
    begin(value) {
      write("attempts.ndjson", { event: "attempt-started", ...value }, { append: true });
    },
    retain(load) {
      const value = {
        ...load,
        responses: load.responses.map((response) => {
          if (!response.parsed) return response;
          const digest = hash(response.bodyWire);
          if (!bodies.has(digest)) {
            write(`bodies/${digest}.json`, response.bodyWire);
            bodies.set(digest, {
              bytes: response.bodyBytes,
              ...(outputDirectory ? { file: `bodies/${digest}.json` } : { wire: response.bodyWire }),
            });
          }
          const { body: _body, bodyWire: _wire, ...rest } = response;
          return { ...rest, bodyArtifact: { sha256: digest, bytes: response.bodyBytes } };
        }),
      };
      const size = Buffer.byteLength(JSON.stringify(value));
      if (size > LIMITS.attemptRecordBytes) throw new Error("Fixed raw attempt record budget exhausted");
      write("attempts.ndjson", { event: "attempt-completed", ...value }, { append: true });
      records.push(value);
      return value;
    },
    get remaining() {
      return LIMITS.artifactBytes - bytes - LIMITS.finalReserveBytes;
    },
    get bytes() {
      return bytes;
    },
    inventory: () =>
      Object.fromEntries(
        [...files].map(([name, file]) => [name, { bytes: file.bytes, sha256: file.digest.copy().digest("hex") }])
      ),
    records,
    bodies,
  };
}

function sourceBinding(plan) {
  const source = plan.source;
  return {
    sha256: source.sha256,
    records: source.records,
    bytes: source.bytes,
    dataset: source.dataset,
    producer: source.producer,
    consistency: source.consistency,
    sourceVersion: source.sourceVersion,
    sourceCutAt: source.sourceCutAt,
    domain: source.domain,
    history: source.history,
    collation: source.collation,
    availability: source.availability ?? null,
    upstreamIngestion: "unknown",
  };
}
function environment() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    driver: require("mongodb/package.json").version,
    codec: require("roaring/package.json").version,
    candidateRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim(),
    tools: Object.fromEntries(
      [
        "loads.cjs",
        "application.cjs",
        "application-child.cjs",
        "driver-trace.cjs",
        "compare.cjs",
        "contract-fixture.cjs",
      ].map((file) => [file, hash(fs.readFileSync(path.join(__dirname, file)))])
    ),
    originalLegacyReferenceSha256: hash(fs.readFileSync(path.join(__dirname, "references/legacy-six-endpoints.json"))),
    productSources: Object.fromEntries(
      [
        "modules/patients/backend.js",
        "modules/patients/read-model/reader.js",
        "modules/patients/read-model/lifetime.js",
        "modules/patients/read-model/capacity.js",
      ].map((file) => [file, hash(fs.readFileSync(path.join(ROOT, "src", file)))])
    ),
  };
}

// The only timed work is six real existing HTTP controllers. All scheduling,
// first/later sessions, exact comparisons, failure retention and bounded local
// artifacts are owned here. No supplied boolean can authorize a release gate.
async function runLoads(plan, { openApplication, outputDirectory } = {}) {
  checkPlan(plan);
  // Freeze the exact JSON wire plan for this execution. Request strings retain
  // all original bytes and JSON presence/types; later caller mutation cannot
  // change a running condition or its reference.
  plan = JSON.parse(JSON.stringify(plan));
  if (typeof openApplication !== "function") throw new Error("An actual fixture application opener is required");
  const count = plan.phase === "explore" ? 20 : 100;
  const store = artifactStore(outputDirectory);
  const manifest = {
    schema: "patients-six-route-load-v1",
    id: randomUUID(),
    scope: plan.scope,
    phase: plan.phase,
    startedAt: new Date().toISOString(),
    source: sourceBinding(plan),
    generation: plan.generation,
    reference: plan.reference,
    environment: environment(),
    calculation: { clock: plan.clock, timeZone: plan.timeZone },
    limits: LIMITS,
    declaredConditionCount: plan.conditions.length,
    plannedAttempts: plan.conditions.reduce((n, condition) => n + count + (condition.trial === "later" ? 5 : 0), 0),
    conditions: plan.conditions.map(({ reference, ...condition }) => ({
      ...condition,
      requestSha256: hash(condition.requestBytes),
      referenceSha256: hash(JSON.stringify(reference)),
    })),
  };
  store.write("manifest.json", manifest);
  store.write(
    "references.json",
    plan.conditions.map(({ id, reference }) => ({ id, reference }))
  );
  const conditions = [];
  let stopped;
  const plannedMetadataBytes =
    manifest.plannedAttempts * 8192 +
    Buffer.byteLength(JSON.stringify(manifest)) +
    Buffer.byteLength(JSON.stringify(plan.conditions.map(({ reference }) => reference)));
  if (plannedMetadataBytes + 6 * 1048576 + LIMITS.finalReserveBytes > LIMITS.artifactBytes)
    stopped = "planned-artifact-demand-exceeds-fixed-allowance";
  for (const condition of plan.conditions) {
    const retained = [],
      warmups = [];
    let app,
      lifecycleFailure,
      startupMS = 0,
      sessionCount = 0;
    const sessionActors = [];
    const negative = condition.negative === true || condition.reference.some(({ status }) => status >= 400);
    async function open() {
      const at = monotonicClock.now();
      try {
        app = await openApplication(condition);
        sessionCount += 1;
        if (
          !Number.isInteger(app.actor?.pid) ||
          !Number.isSafeInteger(app.actor?.startedAt) ||
          app.runtime?.node !== process.version
        )
          throw new Error("Missing actual child runtime/incarnation");
        if (
          app.runtime.clock !== plan.clock ||
          app.runtime.timeZone !== plan.timeZone ||
          typeof app.runtime.mongo !== "string" ||
          !compareResponses(
            { status: 200, body: app.productSources },
            { status: 200, body: manifest.environment.productSources }
          ).equal
        )
          throw new Error("Actual child calculation/runtime/product bytes differ from plan");
        if (
          app.generation?.id !== plan.generation.id ||
          app.generation.sourceSha256 !== plan.source.sha256 ||
          !compareResponses(
            { status: 200, body: app.generation.versions },
            { status: 200, body: plan.generation.versions }
          ).equal
        )
          throw new Error("Actual child source/generation/policy differs from plan");
        if (plan.generation.seal && plan.generation.seal !== app.generation.seal)
          throw new Error("Actual generation seal differs from plan");
        sessionActors.push({ ...app.actor, runtime: app.runtime, generation: app.generation });
      } finally {
        startupMS += monotonicClock.now() - at;
      }
    }
    async function close() {
      if (!app) return;
      try {
        const result = await app.close();
        if (!result?.exited || result.dependencySettlement === "unverified" || result.graceful === false)
          lifecycleFailure = true;
      } catch {
        lifecycleFailure = true;
      } finally {
        app = undefined;
      }
    }
    const planned = count + (condition.trial === "later" ? 5 : 0);
    for (let index = 0; index < planned && !stopped; index++) {
      const excluded = condition.trial === "later" && index < 5;
      const identity = {
        id: randomUUID(),
        condition: condition.id,
        ordinal: index + 1,
        excluded,
        exclusionReason: excluded ? "five-later-warmups" : null,
        negative,
      };
      // Reserve a complete six-response worst case plus bounded trace and final
      // summary before dispatch. Report storage never silently grows the model.
      if (store.remaining < 6 * 1048576 + LIMITS.attemptRecordBytes) {
        stopped = "insufficient-fixed-artifact-reserve-before-dispatch";
        break;
      }
      try {
        store.begin(identity);
      } catch {
        stopped = "artifact-start-record-unavailable-before-dispatch";
        break;
      }
      let load;
      try {
        if (!app) await open();
        load = await app.captureLoad({ bodyBytes: condition.requestBytes });
        load.comparison = compareLoad(condition, load);
        const actualGenerations = load.telemetry?.requests?.map((request) => request.capacity?.generationId);
        if (!negative && actualGenerations?.some((generationId) => generationId !== plan.generation.id)) {
          load.comparison.equal = false;
          if (load.comparison.differences.length < 64)
            load.comparison.differences.push({ kind: "actual-pinned-generation-does-not-match-plan" });
        }
      } catch (error) {
        load = {
          id: identity.id,
          requestBytes: condition.requestBytes,
          responses: PARTS.map(({ route }) => ({ route, parsed: false, error: "load-not-completed" })),
          complete: false,
          errorEvidenceVerified: false,
          queryErrors: [],
          settlement: { safe: false, proof: "load-start-or-observation-failed" },
          error: "LoadExecutionError",
          comparison: { equal: false, differences: [{ kind: "load-failed" }] },
          startupFailure: !!error.teardown,
        };
      }
      let raw;
      try {
        raw = store.retain({ ...load, ...identity, actor: app?.actor ?? null });
      } catch {
        stopped = "bounded-artifact-retention-failed";
        // The pre-dispatch start record and already written prefix are durable.
        // Preserve a bounded terminal receipt without replacing any old entry.
        raw = {
          ...identity,
          responses: PARTS.map(({ route }) => ({ route, parsed: false, error: "artifact-retention-failed" })),
          complete: false,
          errorEvidenceVerified: false,
          settlement: load.settlement,
          comparison: { equal: false },
          queryErrors: [],
          error: "ArtifactRetentionError",
        };
        try {
          store.write("attempts.ndjson", { event: "attempt-retention-failed", ...raw }, { append: true, reserve: 0 });
          store.records.push(raw);
        } catch {
          /* Started entry still proves this attempted denominator. */
        }
      }
      const sample = {
        id: identity.id,
        durationMs: load.combinedParsedBodiesMS,
        complete: raw.complete,
        correct: raw.comparison.equal && !negative,
        comparisonMatched: raw.comparison.equal,
        errorEvidenceVerified: raw.errorEvidenceVerified,
        queryErrors: load.queryErrors?.length ? [{ count: load.queryErrors.length, rawAttempt: identity.id }] : [],
        error: raw.error ?? false,
      };
      (excluded ? warmups : retained).push(sample);
      if (!raw.settlement.safe || !raw.errorEvidenceVerified) stopped ??= "dependent-work-or-query-evidence-unverified";
      if (condition.trial === "first" || stopped) await close();
      if (lifecycleFailure) stopped = "application-teardown-unverified";
    }
    await close();
    const summary = summarizeAttempts(retained, { requiredAttempts: count });
    const warmupValid =
      condition.trial === "first"
        ? warmups.length === 0
        : warmups.length === 5 &&
          warmups.every(
            (attempt) =>
              attempt.comparisonMatched &&
              attempt.complete &&
              attempt.errorEvidenceVerified &&
              (negative || !attempt.queryErrors.length)
          );
    const negativeComparisons = negative
      ? {
          attempted: retained.length,
          matched: retained.filter(
            (attempt) => attempt.comparisonMatched && attempt.complete && attempt.errorEvidenceVerified
          ).length,
          passed:
            retained.length === count &&
            retained.every((attempt) => attempt.comparisonMatched && attempt.complete && attempt.errorEvidenceVerified),
        }
      : null;
    conditions.push({
      id: condition.id,
      scenario: condition.scenario,
      trial: condition.trial,
      routing: condition.routing,
      attempted: retained.length,
      requiredAttempts: count,
      unexecuted: count - retained.length,
      warmups: {
        required: condition.trial === "later" ? 5 : 0,
        attempted: warmups.length,
        excluded: warmups.length,
        valid: warmupValid,
      },
      sessions: sessionCount,
      sessionActors,
      startupMS,
      startupOutsideResponseTiming: true,
      summary,
      negativeComparisons,
      apiProtocolPassed: !negative && !lifecycleFailure && warmupValid && summary.timingPassed,
      failure: lifecycleFailure ? "application-teardown-unverified" : (stopped ?? null),
    });
  }
  const matrix = [...REQUIRED_FAMILIES, ...SUPPLEMENTAL].map((family) => {
    const exercised = plan.conditions
      .filter(
        (condition) =>
          require("./load-fixture.cjs").fixtureScenario(condition, plan.source).includes(family) &&
          conditions.find((result) => result.id === condition.id)?.apiProtocolPassed
      )
      .map(({ id }) => id);
    return {
      family,
      status: exercised.length ? "partially-exercised-in-exact-finite-fixture" : "unverified",
      exercisedConditions: exercised,
      reason: "full-supported-scenario-matrix-and-external-conditions-remain-unverified",
    };
  });
  const report = {
    schema: manifest.schema,
    manifest,
    conditions,
    attempts: store.records,
    bodies: Object.fromEntries(store.bodies),
    accounting: {
      plannedMetadataBytes,
      plannedWorstCaseRecordBytes: manifest.plannedAttempts * LIMITS.attemptRecordBytes,
      maximumNewBodyBytesPerAttempt: 6 * 1048576,
      initialForecastIsNotGuaranteedWorstCaseFit: true,
      enforcement:
        "fixed-total-plus-complete-next-attempt-reserve-before-every-dispatch; stop-and-retain-partial-on-overflow",
      fixedArtifactBytes: LIMITS.artifactBytes,
      recordedBytesBeforeFinal: store.bytes,
      modelStorageMustReserveArtifactAllowance: true,
      noBudgetIncreaseOnFailure: true,
    },
    completion: stopped ? "partial-failed" : "local-api-protocol-recorded",
    artifactsBeforeFinalReport: store.inventory(),
    stopReason: stopped ?? null,
    matrix,
    timingMeaning:
      "parallel-six-controller-full-JSON-parse-wall-time; excludes startup, trace drain, and actual browser rendering",
    firstMeaning:
      "fresh application process per retained attempt; no same-request response warmup; Mongo/OS caches are not claimed cold",
    releaseGates: {
      page: "failed",
      visibleFreshness: "failed",
      targetCapacity: "blocked",
      fullMatrix: "failed",
      immutableTargetSource: "unverified",
      targetNativePlatform: "unverified",
      production: "not-accepted",
    },
    missingEvidence: [
      "actual frontend initiating-action/request-order/current-six/error/freshness rendering",
      "representative full target source/history/runtime/native/topology/headroom",
      "actual mutation-cut-acquisition-build-publication-recovery-cleanup-display chain within 24 hours",
      "unknown upstream ingestion",
      "independently verified complete scenario coverage",
    ],
  };
  const compact = {
    ...report,
    attempts: { file: "attempts.ndjson", records: store.records.length },
    bodies: Object.fromEntries(
      [...store.bodies].map(([id, value]) => [id, { bytes: value.bytes, file: `bodies/${id}.json` }])
    ),
    conditions: conditions.map(({ summary, ...condition }) => ({
      ...condition,
      summary: {
        ...summary,
        samples: summary.samples.map(({ id, successful, effectiveDurationMs, failureReasons }) => ({
          id,
          successful,
          effectiveDurationMs,
          failureReasons,
        })),
      },
    })),
  };
  try {
    store.write("report.json", compact, { reserve: 4096 });
  } catch {
    report.completion = "partial-failed";
    report.stopReason = "final-artifact-write-failed";
    const receipt = {
      schema: manifest.schema,
      id: manifest.id,
      completion: report.completion,
      reason: report.stopReason,
      attempted: store.records.length,
      attemptsFile: "attempts.ndjson",
      preserveFixture: true,
    };
    try {
      store.write("failure.json", receipt, { reserve: 0 });
      report.failureReceipt = outputDirectory ? "failure.json" : "in-memory";
    } catch {
      // A broken/full destination must not make stdout the only failure record.
      const fallback = path.join(require("node:os").tmpdir(), `patients-load-artifact-failure-${manifest.id}.json`);
      try {
        fs.writeFileSync(fallback, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
        report.failureReceipt = fallback;
      } catch {
        report.failureReceipt = "durability-unverified-existing-prefix-retained";
      }
    }
  }
  return report;
}
module.exports = { runLoads, LIMITS };
