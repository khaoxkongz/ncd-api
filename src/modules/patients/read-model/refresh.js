const { randomUUID, verify } = require("node:crypto");
const { BSON } = require("mongodb");
const { AsyncLocalStorage } = require("node:async_hooks");
const { performance: monotonicClock } = require("node:perf_hooks");
const { createBudget } = require("./budget");
const { VERSIONS } = require("./schema");

const RUNS = "patients_refresh_runs";
const HOUR = 3600000;
const ALLOCATION = Object.freeze({ acquisitionMS: 2 * HOUR, buildMS: 6 * HOUR, reserveMS: 4 * HOUR });
const refreshContext = new AsyncLocalStorage();

function instant(value) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid refresh time");
  return result.toISOString();
}

async function runRefresh({ builder, db, clock, request, declaredBudget, comparisonContext }) {
  createBudget(declaredBudget);
  const cutAt = instant(request.cutAt);
  const cut = new Date(cutAt).getTime();
  if (![4, 16].includes(new Date(cutAt).getUTCHours()) || cut % HOUR)
    throw new Error("Refresh cuts must be 11:00 or 23:00 Asia/Bangkok");
  if (typeof request.acquire !== "function" || comparisonContext.comparisonOnly === true)
    throw new Error("A managed immutable-source acquisition adapter is required");
  const startedAt = instant(clock()),
    started = new Date(startedAt).getTime(),
    monotonicStart = monotonicClock.now();
  if (started < cut) throw new Error("Refresh cut has not occurred");
  const ledger = {
    cutAt,
    deadlineAt: instant(cut + 12 * HOUR),
    acquisitionLimitMS: ALLOCATION.acquisitionMS,
    buildLimitMS: ALLOCATION.buildMS,
    reserveLimitMS: ALLOCATION.reserveMS,
    queueMS: started - cut,
    acquisitionMS: 0,
    buildMS: 0,
    cleanupMS: 0,
    reserveSpentMS: started - cut,
  };
  const run = {
    _id: cutAt,
    runId: randomUUID(),
    version: "full-refresh-v1",
    versions: VERSIONS,
    budget: declaredBudget,
    status: "acquiring",
    startedAt,
    ledger,
    events: [],
    visibility: "unverified-frontend-deferred",
  };
  const runs = db.collection(RUNS);
  let lastWall = started,
    reserve = ledger.queueMS,
    phase;
  function now() {
    return instant(clock());
  }
  function observe() {
    const at = new Date(now()).getTime();
    if (at < lastWall) throw new Error("Refresh clock moved backwards");
    lastWall = at;
    const elapsed = Math.max(at - phase.started, monotonicClock.now() - phase.monotonicStart);
    const limit = ALLOCATION[phase.key] ?? 0;
    if (phase.key !== "reserveMS") ledger[phase.key] = elapsed;
    ledger.reserveSpentMS =
      reserve + (phase.key === "reserveMS" || phase.key === "cleanupMS" ? elapsed : Math.max(0, elapsed - limit));
    return {
      at,
      elapsed,
      finalRemaining: 12 * HOUR - ledger.queueMS - Math.max(at - started, monotonicClock.now() - monotonicStart),
    };
  }
  function begin(name, key) {
    if (phase) {
      const observed = observe();
      reserve = ledger.reserveSpentMS;
      run.events.push({
        phase: phase.name,
        startedAt: instant(phase.started),
        endedAt: instant(observed.at),
        elapsedMS: observed.elapsed,
      });
    }
    phase = { name, key, started: new Date(now()).getTime(), monotonicStart: monotonicClock.now() };
  }
  begin("coordination", "reserveMS");
  function remaining({ settlement = false } = {}) {
    const observed = observe();
    if (observed.finalRemaining <= 0 || ledger.reserveSpentMS >= ALLOCATION.reserveMS)
      throw new Error("Shared refresh reserve or final deadline exceeded");
    let available = observed.finalRemaining;
    if (["reserveMS", "cleanupMS"].includes(phase.key) || settlement)
      available = Math.min(available, ALLOCATION.reserveMS - ledger.reserveSpentMS);
    if (!settlement && ["acquisitionMS", "buildMS"].includes(phase.key)) {
      available = Math.min(available, ALLOCATION[phase.key] - observed.elapsed);
      if (available <= 0)
        throw new Error(
          `Refresh ${phase.key === "buildMS" ? "build/check/availability" : "acquisition"} ceiling exceeded`
        );
    }
    return Math.max(1, Math.floor(available));
  }
  const deadlines = { remaining: () => remaining(), settlementRemaining: () => remaining({ settlement: true }) };
  const options = () => ({
    maxTimeMS: Math.min(60000, remaining({ settlement: true })),
    writeConcern: { w: "majority" },
  });
  async function save() {
    observe();
    if (BSON.serialize(run).length > 65536) throw new Error("Refresh ledger byte budget exceeded");
    const result = await runs.replaceOne({ _id: cutAt, runId: run.runId }, run, options());
    if (result.matchedCount !== 1) throw new Error("Refresh ledger ownership changed");
  }
  let inserted = false;
  try {
    // One immutable record per scheduled cut. A duplicate execution cannot
    // acquire a fresh acquisition/build/reserve allocation for that same cut.
    await runs.insertOne(run, options());
    inserted = true;
    remaining();
    begin("acquisition", "acquisitionMS");
    run.acquisitionStartedAt = instant(phase.started);
    const sourceCut = await request.acquire({
      cutAt,
      deadlineAt: instant(phase.started + remaining()),
      signal: AbortSignal.timeout(remaining()),
    });
    remaining();
    const acquiredAt = now();
    run.acquiredAt = acquiredAt;
    if (
      !Buffer.isBuffer(sourceCut?.manifest) ||
      !Buffer.isBuffer(sourceCut?.signature) ||
      sourceCut.manifest.length * 4 + sourceCut.signature.length > declaredBudget.maxSerializedBytes
    )
      throw new Error("Refresh source evidence buffer budget exceeded");
    const manifest = BSON.deserialize(sourceCut.manifest);
    const key = comparisonContext.trustedProducers?.[manifest.producer];
    if (!key || !verify(null, sourceCut.manifest, key, sourceCut.signature))
      throw new Error("Untrusted refresh availability evidence");
    const availability = manifest.availability;
    if (
      instant(manifest.sourceCutAt) !== cutAt ||
      !availability ||
      instant(availability.mutationAvailableThrough) !== cutAt ||
      typeof availability.evidence !== "string" ||
      !availability.evidence ||
      availability.evidence.length > 128 ||
      new Date(instant(availability.exportAvailableAt)).getTime() < cut ||
      new Date(instant(availability.exportAvailableAt)).getTime() > cut + ALLOCATION.acquisitionMS ||
      new Date(availability.exportAvailableAt) > new Date(acquiredAt)
    )
      throw new Error("Missing or late signed source availability evidence");
    run.source = {
      sourceCutAt: cutAt,
      sourceVersion: manifest.sourceVersion,
      mutationAvailableThrough: availability.mutationAvailableThrough,
      exportAvailableAt: availability.exportAvailableAt,
      evidence: availability.evidence,
    };
    remaining();
    begin("coordination", "reserveMS");
    run.status = "building";
    await save();
    remaining();
    begin("cleanup", "cleanupMS");
    run.cleanup = await refreshContext.run(deadlines, () => builder.cleanup());
    remaining();
    begin("build-check-publication", "buildMS");
    run.buildStartedAt = instant(phase.started);
    const candidate = await refreshContext.run(deadlines, () =>
      builder.build(sourceCut, declaredBudget, { ...comparisonContext, comparisonOnly: false })
    );
    run.candidate = candidate;
    run.generationId = candidate.generationId;
    remaining();
    run.active = await refreshContext.run(deadlines, () => builder.publish(candidate, request.expectedActive));
    run.publishedAt = now();
    remaining();
    begin("coordination", "reserveMS");
    run.status = "published";
    await save();
    remaining();
    return run;
  } catch (error) {
    try {
      observe();
    } catch {
      /* Keep the last coherent ledger on a clock failure. */
    }
    run.status = run.active
      ? "published-late"
      : error.publicationOutcome === "unknown"
        ? "publication-uncertain"
        : "failed";
    run.failedAt = now();
    if (deadlines.generationId) run.generationId = deadlines.generationId;
    if (deadlines.completedStages) run.completedStages = deadlines.completedStages;
    // Adapter/database messages can contain source values or credentials.
    run.failure = {
      name: error.name,
      phase: phase.name,
      reason: "Refresh phase failed",
      ...(Number.isInteger(error.code) ? { code: error.code } : {}),
    };
    if (inserted) {
      try {
        await save();
      } catch {
        run.ledgerPersistence = "unverified";
      }
    }
    error.report = run;
    throw error;
  }
}

module.exports = { RUNS, runRefresh, refreshContext };
