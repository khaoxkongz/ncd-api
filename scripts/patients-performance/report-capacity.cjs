const assert = require("node:assert/strict");
const { performance: monotonicClock } = require("node:perf_hooks");
const { BSON } = require("mongodb");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { BASELINE_REVISION } = require("./contract-fixture.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { policy } = require("./capacity-fixture.cjs");
const { ACTOR } = require("../../src/modules/patients/read-model/capacity");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { startApplication } = require("./application.cjs");
const {
  CUTS,
  PAGE_CLOCK,
  CASES,
  sealRefresh,
  documents,
  page,
  comparable,
  seedBaseline,
} = require("./refresh-fixture.cjs");

async function main() {
  const startedAt = new Date().toISOString(),
    started = monotonicClock.now();
  const fixture = await openFixture(),
    baseline = archiveBaseline();
  const cuts = [sealRefresh(1), sealRefresh(2)];
  const failureAt = "2025-01-10T04:00:00.000Z";
  const rejected = sealRefresh(1, {
    sourceCutAt: failureAt,
    sourceVersion: "larger-rejected-full-history",
    availability: {
      mutationAvailableThrough: failureAt,
      exportAvailableAt: failureAt,
      evidence: "finite-capacity-failure-source-v1",
    },
  });
  let legacy,
    optimized,
    config,
    now,
    active = null,
    building = false,
    maximumHeavy = 0;
  const heavy = new Set();
  fixture.client.on("commandStarted", ({ requestId, command }) => {
    if (building && (command.aggregate || command.createIndexes)) {
      heavy.add(requestId);
      maximumHeavy = Math.max(maximumHeavy, heavy.size);
    }
  });
  for (const event of ["commandSucceeded", "commandFailed"])
    fixture.client.on(event, ({ requestId }) => heavy.delete(requestId));
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: PAGE_CLOCK });
    optimized = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: PAGE_CLOCK,
      capacityFactory: (actor) => {
        config = policy([...cuts, rejected], {
          processes: [
            { id: "builder", ...ACTOR, roles: ["builder", "api"] },
            { id: "api", ...actor, roles: ["api"] },
          ],
        });
        return { ...config, processId: "api" };
      },
    });
    const builder = createBuilder({ db: fixture.db, capacity: config, clock: () => new Date(now), timeZone: "UTC" });
    const cycles = [],
      concurrent = [];
    for (const [index, cut] of cuts.entries()) {
      await seedBaseline(fixture.db, baseline, documents(index + 1), legacy);
      now = new Date(new Date(CUTS[index]).getTime() + 60000);
      building = true;
      const running = builder.refresh(
        { cutAt: CUTS[index], expectedActive: active, acquire: async () => cut.sourceCut },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      );
      void running.catch(() => {});
      if (index) {
        const serving = await page(optimized, CASES[0][1]);
        assert(serving.responses.every((item) => item.status === 200 && item.sourceCutAt === CUTS[0]));
        assert.deepEqual(comparable(serving), comparable(cycles[0].cases[0].actual));
        concurrent.push({ condition: "full-six-old-generation-while-new-full-raw-refresh-is-running", serving });
      }
      const run = await running;
      building = false;
      active = run.active;
      assert.equal(run.status, "published");
      assert.equal(run.candidate.resources.capacity.acceptance, "failed");
      assert.equal(run.candidate.resources.capacity.targetAcceptance, "blocked");
      assert.equal(Object.keys(run.candidate.resources.ledger.summary.memberships).length, 15);
      assert(Object.values(run.candidate.resources.ledger.summary.memberships).every((item) => item.expanded > 0));
      const cases = [];
      for (const [name, body] of [CASES[0], CASES[CASES.length - 1]]) {
        const reference = await page(legacy, body),
          repeated = await page(legacy, body),
          actual = await page(optimized, body);
        assert.deepEqual(comparable(reference), comparable(repeated), `unstable baseline ${index}/${name}`);
        assert.deepEqual(comparable(actual), comparable(reference), `changed full result ${index}/${name}`);
        assert(actual.responses.every((item) => item.status === 200 && item.sourceCutAt === CUTS[index]));
        cases.push({ name, reference, actual, equalEntireBodiesAndStatus: true });
      }
      cycles.push({
        cutAt: CUTS[index],
        generationId: run.generationId,
        resources: run.candidate.resources,
        inventory: run.candidate.inventory,
        complete: run.candidate.complete,
        capacityKey: run.capacityKey,
        ledger: run.ledger,
        cases,
      });
    }
    assert.notEqual(cycles[0].resources.ledger.raw.records, cycles[1].resources.ledger.raw.records);
    assert.equal(cycles[0].capacityKey, cycles[1].capacityKey);
    const rejectedManifest = BSON.deserialize(rejected.sourceCut.manifest);
    assert(rejectedManifest.records > cycles[1].resources.ledger.raw.records);
    assert.notDeepEqual(comparable(cycles[0].cases[0].actual), comparable(cycles[1].cases[0].actual));
    const before = await page(optimized, CASES[0][1]);
    const fixedRejectedBudget = { ...FIXTURE_BUDGET, maxStorageBytes: 1 };
    now = new Date("2025-01-10T04:01:00.000Z");
    const request = { cutAt: failureAt, expectedActive: active, acquire: async () => rejected.sourceCut };
    const failures = [];
    let resumeRunId;
    for (const attempt of [1, 2]) {
      const failure = await builder
        .refresh({ ...request, ...(resumeRunId ? { resumeRunId } : {}) }, fixedRejectedBudget, {
          ...rejected.comparisonContext,
          comparisonOnly: false,
        })
        .catch((error) => error);
      assert(failure instanceof Error);
      assert.equal(failure.message, "Storage budget exceeded");
      assert.equal(failure.report.status, "failed");
      assert(failure.resources.storageBytes > 1);
      resumeRunId ??= failure.report.runId;
      assert.equal(failure.report.runId, resumeRunId);
      assert.deepEqual(failure.report.budget, fixedRejectedBudget);
      const after = await page(optimized, CASES[0][1]);
      assert.deepEqual(
        after.responses.map(({ parsedBodyMS: _timing, ...item }) => item),
        before.responses.map(({ parsedBodyMS: _timing, ...item }) => item)
      );
      failures.push({
        attempt,
        message: failure.message,
        runId: failure.report.runId,
        generationId: failure.report.generationId,
        capacityKey: failure.report.capacityKey,
        buildStartedAt: failure.report.buildStartedAt,
        ledger: failure.report.ledger,
        fixedBudget: failure.report.budget,
        resources: failure.resources,
        after,
        preservedEveryEntireBodyStatusAndSource: true,
      });
      now = new Date(now.getTime() + 60000);
    }
    assert.equal(failures[0].generationId, failures[1].generationId);
    assert.equal(failures[0].buildStartedAt, failures[1].buildStartedAt);
    assert(failures[1].ledger.reserveSpentMS >= failures[0].ledger.reserveSpentMS);
    const removed = await builder.cleanup(failures[1].generationId);
    assert.deepEqual(removed.removed, [failures[1].generationId]);
    const repeat = await builder.cleanup(failures[1].generationId);
    assert.deepEqual(repeat.removed, []);
    const control = await fixture.db
      .collection("patients_model_control")
      .findOne({ _id: "patients" }, { promoteLongs: false });
    assert.equal(control.slots.filter((item) => item.state !== "free").length, 1);
    assert.equal(control.pins.length, 0);
    assert.equal(control.capacity.owners.length, 0);
    assert.equal(control.retainedSourceFiles.files.length, 3);
    assert.equal(maximumHeavy, 1);
    const result = {
      schema: "ticket33-capacity-fixture-v1",
      evidence: "isolated-loopback-real-six-controllers-mongodb-and-trusted-fixture-composition",
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMS: monotonicClock.now() - started,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        mongo: fixture.version,
        driver: require("mongodb/package.json").version,
        codec: require("roaring/package.json").version,
        bufferPoolBytes: Buffer.poolSize,
      },
      baselineRevision: BASELINE_REVISION,
      integrationBase: "06d8b118ec9d5c368d2bbd69464e76d350f96714",
      declaration:
        "Synthetic operator headroom and guard inputs verify code mechanics. They are not measured host/DB headroom, representative peaks, full target source or page acceptance.",
      measurementLimits: [
        "process RSS/CPU/FS counters include all roles and Worker threads; diagnostics are not added as independent physical totals",
        "decoded/native workspace reservations are estimates; retained known buffers charge complete unique physical backing",
        "cursor/encoding reservations precede dispatch/allocation; ownership survives real detached work and socket encoding",
        "collection/index samples include shared layouts, control, journals, all staging prefixes and known retained source files once",
        "per-generation BSON is logical and is not added to shared physical collection allocation",
        "DB transient/volume/scratch/log peaks and representative CPU/controlling IO remain unavailable",
        "injected historical calculation clocks and original cut ledgers are distinct from observed execution time; this is not a 24-hour/page experiment",
      ],
      cycles,
      concurrent,
      rejectedSource: {
        records: rejectedManifest.records,
        history: rejectedManifest.history,
        sourceVersion: rejectedManifest.sourceVersion,
        distinguishableFromActive: true,
        largerThanActive: true,
      },
      failedResourceAttempts: failures,
      cleanup: {
        removed,
        repeat,
        controlBytes: BSON.calculateObjectSize(control),
        pins: control.pins.length,
        occupiedSlots: control.slots.filter((item) => item.state !== "free").length,
        retainedCapacityOwners: control.capacity.owners.length,
        retainedSourceBackings: control.retainedSourceFiles.files.length,
        producerOwnedSourcesAwaitIndependentDeletionProof: true,
      },
      maximumConcurrentBuilderAggregationOrIndexCommands: maximumHeavy,
      releaseGates: {
        targetCapacity: "blocked",
        immutableTargetSource: "unverified",
        targetNativePlatform: "unverified",
        actualPageAndFrontend: "deferred-and-unverified",
        production: "not-accepted",
      },
    };
    process.stdout.write(
      `${JSON.stringify(result, (key, value) => (key === "host" ? "isolated-fixture-host" : value), 2)}\n`
    );
  } finally {
    await optimized?.close();
    await legacy?.close();
    for (const cut of [...cuts, rejected]) cut.close();
    baseline.close();
    await fixture.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
