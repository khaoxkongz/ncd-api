const { randomUUID, verify } = require("node:crypto");
const { BSON } = require("mongodb");
const { AsyncLocalStorage } = require("node:async_hooks");
const { performance: monotonicClock } = require("node:perf_hooks");
const { createBudget } = require("./budget");
const { VERSIONS } = require("./schema");
const { createControl } = require("./control");
const { WORKER } = require("./lifetime");
const { identity: sourceIdentity } = require("./recovery");

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
  const invokedAt = instant(clock()),
    invoked = new Date(invokedAt).getTime(),
    monotonicStart = monotonicClock.now();
  if (invoked < cut) throw new Error("Refresh cut has not occurred");
  const runs = db.collection(RUNS);
  const previous = request.resumeRunId
    ? await runs.findOne(
        { _id: cutAt, runId: request.resumeRunId },
        { maxTimeMS: 60000, readPreference: "primary", readConcern: { level: "majority" } }
      )
    : null;
  const previousSource = previous?.source;
  const previousEvidence = previous?.sourceEvidence;
  if (
    request.resumeRunId &&
    (!previous ||
      !BSON.serialize(previous.budget).equals(BSON.serialize(declaredBudget)) ||
      !BSON.serialize(previous.versions).equals(BSON.serialize(VERSIONS)) ||
      !BSON.serialize({ active: previous.expectedActive }).equals(BSON.serialize({ active: request.expectedActive })))
  )
    throw new Error("Refresh recovery identity, policy or fixed budget changed");
  if (previous) {
    const lastWall = previous.accounting?.lastWallAt ?? new Date(previous.failedAt ?? previous.startedAt).getTime();
    if (!Number.isFinite(lastWall) || invoked < lastWall) throw new Error("Refresh recovery clock moved backwards");
    const spent = previous.ledger.reserveSpentMS + invoked - lastWall;
    const available = Math.min(cut + 12 * HOUR - invoked, ALLOCATION.reserveMS - spent);
    if (available <= 0) throw new Error("Original refresh reserve exhausted; outcome remains protected");
    const observationBudget = createBudget({ maxTimeMS: Math.min(60000, Math.floor(available)) }, { request: true });
    const control = await createControl({ db }).read(observationBudget);
    const slot = control.slots.find((item) => item.generationId === previous.generationId);
    const publicationId = `publish:${previous.generationId}:${previous.builder?.run ?? previous.candidate?.control?.run}`;
    if (slot?.publication?.id === publicationId) {
      previous.active = slot.publication.result;
      previous.status = "published-reconciled";
      previous.reconciledAt = invokedAt;
      previous.visibility = "unverified-frontend-deferred";
      previous.ledger.reserveSpentMS = spent;
      previous.accounting = {
        ...previous.accounting,
        lastWallAt: invoked,
        elapsedMS: Math.max(previous.accounting?.elapsedMS ?? 0, invoked - new Date(previous.startedAt).getTime()),
      };
      const revision = previous.ledgerRevision;
      previous.ledgerRevision += 1;
      previous.lastTransition = randomUUID();
      try {
        const result = await runs.replaceOne(
          { _id: cutAt, runId: previous.runId, ledgerRevision: revision },
          previous,
          observationBudget.options({ writeConcern: { w: "majority" } })
        );
        if (result.matchedCount !== 1) throw new Error("Refresh ledger ownership changed");
      } catch {
        previous.ledgerPersistence = "unverified";
      }
      return previous;
    }
    if (previous.status === "publication-uncertain" && !slot)
      throw new Error("Publication receipt is unavailable; outcome remains protected");
    if (
      previous.generationId &&
      (!slot?.settled || !["failed", "ready"].includes(slot.state) || slot.refresh?.runId !== previous.runId)
    )
      throw new Error("Refresh predecessor remains owned or its outcome is unresolved");
    if (!previous.generationId && !["failed"].includes(previous.status))
      throw new Error("Refresh acquisition predecessor is unverified");
  }
  const ledger = previous?.ledger ?? {
    cutAt,
    deadlineAt: instant(cut + 12 * HOUR),
    acquisitionLimitMS: ALLOCATION.acquisitionMS,
    buildLimitMS: ALLOCATION.buildMS,
    reserveLimitMS: ALLOCATION.reserveMS,
    queueMS: invoked - cut,
    acquisitionMS: 0,
    buildMS: 0,
    cleanupMS: 0,
    reserveSpentMS: invoked - cut,
  };
  const run = previous ?? {
    _id: cutAt,
    runId: randomUUID(),
    ledgerRevision: 0,
    version: "full-refresh-v1",
    versions: VERSIONS,
    budget: declaredBudget,
    status: "acquiring",
    startedAt: invokedAt,
    expectedActive: request.expectedActive,
    worker: WORKER,
    ledger,
    events: [],
    visibility: "unverified-frontend-deferred",
  };
  const started = new Date(run.startedAt).getTime();
  const lastObserved =
    previous?.accounting?.lastWallAt ??
    (previous ? new Date(previous.failedAt ?? previous.startedAt).getTime() : invoked);
  if (invoked < lastObserved) throw new Error("Refresh recovery clock moved backwards");
  const elapsedBase = Math.max(previous?.accounting?.elapsedMS ?? 0, invoked - started);
  let lastWall = invoked,
    reserve = previous ? ledger.reserveSpentMS + invoked - lastObserved : ledger.queueMS,
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
    const totalElapsed = Math.max(at - started, elapsedBase + monotonicClock.now() - monotonicStart);
    run.accounting = {
      lastWallAt: at,
      elapsedMS: totalElapsed,
      phase: phase.name,
      phaseKey: phase.key,
      phaseStartedAt: instant(phase.started),
      phaseElapsedMS: elapsed,
    };
    return {
      at,
      elapsed,
      finalRemaining: Math.min(cut + 12 * HOUR - at, 12 * HOUR - ledger.queueMS - totalElapsed),
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
    const revision = run.ledgerRevision;
    run.ledgerRevision += 1;
    run.lastTransition = randomUUID();
    if (BSON.serialize(run).length > 65536) throw new Error("Refresh ledger byte budget exceeded");
    try {
      const result = await runs.replaceOne({ _id: cutAt, runId: run.runId, ledgerRevision: revision }, run, options());
      if (result.matchedCount !== 1) throw new Error("Refresh ledger ownership changed");
    } catch (error) {
      const actual = await runs.findOne(
        { _id: cutAt, runId: run.runId },
        {
          maxTimeMS: Math.min(60000, remaining({ settlement: true })),
          readPreference: "primary",
          readConcern: { level: "majority" },
        }
      );
      if (actual?.ledgerRevision !== run.ledgerRevision || actual.lastTransition !== run.lastTransition) throw error;
    }
  }
  deadlines.bindGeneration = async (generationId, claim) => {
    run.generationId = generationId;
    run.builder = claim;
    await save();
    return { cutAt, runId: run.runId };
  };
  let inserted = false;
  try {
    // One immutable record per scheduled cut. A duplicate execution cannot
    // acquire a fresh acquisition/build/reserve allocation for that same cut.
    if (previous) {
      run.attemptId = randomUUID();
      run.status = "recovering";
      await save();
    } else
      try {
        await runs.insertOne(run, options());
      } catch (error) {
        const actual = await runs.findOne(
          { _id: cutAt },
          {
            maxTimeMS: Math.min(60000, remaining({ settlement: true })),
            readPreference: "primary",
            readConcern: { level: "majority" },
          }
        );
        if (actual?.runId !== run.runId) throw error;
      }
    inserted = true;
    remaining();
    begin("acquisition", previous ? "reserveMS" : "acquisitionMS");
    run.acquisitionStartedAt ??= instant(phase.started);
    const sourceCut = await request.acquire({
      cutAt,
      deadlineAt: instant(phase.started + remaining()),
      signal: AbortSignal.timeout(remaining()),
    });
    remaining();
    const acquiredAt = now();
    run.acquiredAt ??= acquiredAt;
    if (
      !Buffer.isBuffer(sourceCut?.manifest) ||
      !Buffer.isBuffer(sourceCut?.signature) ||
      sourceCut.manifest.length * 4 + sourceCut.signature.length > declaredBudget.maxSerializedBytes
    )
      throw new Error("Refresh source evidence buffer budget exceeded");
    const manifest = BSON.deserialize(sourceCut.manifest);
    const evidence = sourceIdentity(sourceCut, comparisonContext, declaredBudget);
    if (previousEvidence && !BSON.serialize(previousEvidence).equals(BSON.serialize(evidence)))
      throw new Error("Refresh recovery source changed");
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
    if (
      previousSource &&
      (previousSource.sourceVersion !== manifest.sourceVersion ||
        instant(previousSource.sourceCutAt) !== instant(manifest.sourceCutAt))
    )
      throw new Error("Refresh recovery source changed");
    run.source = {
      sourceCutAt: cutAt,
      sourceVersion: manifest.sourceVersion,
      mutationAvailableThrough: availability.mutationAvailableThrough,
      exportAvailableAt: availability.exportAvailableAt,
      evidence: availability.evidence,
    };
    run.sourceEvidence = evidence;
    remaining();
    begin("coordination", "reserveMS");
    run.status = "building";
    await save();
    remaining();
    begin("cleanup", previous ? "reserveMS" : "cleanupMS");
    if (!previous?.generationId) run.cleanup = await refreshContext.run(deadlines, () => builder.cleanup());
    remaining();
    begin("build-check-publication", previous ? "reserveMS" : "buildMS");
    run.buildStartedAt ??= instant(phase.started);
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
  } catch (rejection) {
    const error = rejection instanceof Error ? rejection : new Error("Refresh phase failed");
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
