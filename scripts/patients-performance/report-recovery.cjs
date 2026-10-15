const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { performance: monotonicClock } = require("node:perf_hooks");
const { BSON } = require("mongodb");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { BASELINE_REVISION } = require("./contract-fixture.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const {
  CUTS,
  PAGE_CLOCK,
  CASES,
  documents,
  sealRefresh,
  page,
  comparable,
  seedBaseline,
} = require("./refresh-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { startApplication } = require("./application.cjs");

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const semantic = (capture) =>
  capture.responses.map(({ route, status, body, sourceCutAt, state }) => ({ route, status, body, sourceCutAt, state }));
async function main() {
  const executionStartedAt = new Date().toISOString(),
    started = monotonicClock.now();
  const fixture = await openFixture(),
    baseline = archiveBaseline();
  const cuts = [sealRefresh(1), sealRefresh(2)];
  let legacy,
    optimized,
    building = false,
    peakHeavyOperations = 0;
  const activeCommands = new Set();
  fixture.client.on("commandStarted", ({ command, requestId }) => {
    if (building && (command.aggregate || command.createIndexes)) {
      activeCommands.add(requestId);
      peakHeavyOperations = Math.max(peakHeavyOperations, activeCommands.size);
    }
  });
  for (const event of ["commandSucceeded", "commandFailed"])
    fixture.client.on(event, ({ requestId }) => activeCommands.delete(requestId));
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: PAGE_CLOCK });
    optimized = await startApplication({ db: fixture.db, activeGeneration: true, clock: PAGE_CLOCK });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(PAGE_CLOCK), timeZone: "UTC" });
    const evidence = [];
    let active = null,
      old,
      failed,
      recovered,
      retainedBeforeRecovery;
    for (const [index, cut] of cuts.entries()) {
      const referenceSource = await seedBaseline(fixture.db, baseline, documents(index + 1), legacy);
      building = true;
      if (index === 0) {
        old = await builder.build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
        active = await builder.publish(old, active);
      } else {
        const before = await page(optimized, CASES[0][1]);
        await fixture.db.command({ collMod: "patients_month_atoms", validator: { $expr: { $eq: [1, 0] } } });
        const rejected = await builder
          .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
          .catch((error) => error);
        assert.equal(rejected.code, 121);
        const afterFailure = await page(optimized, CASES[0][1]);
        const failureDescriptor = await fixture.db
          .collection("patients_generations")
          .findOne({ _id: rejected.generationId });
        assert.deepEqual(semantic(afterFailure), semantic(before));
        failed = {
          phase: "stored-month-output",
          error: "MongoServerError",
          code: 121,
          generationId: rejected.generationId,
          oldSixUnchanged: true,
          oldResponsesSha256: digest(semantic(afterFailure)),
          termination: failureDescriptor.termination,
        };
        const prefix = `patients_stage_${rejected.generationId.replaceAll("-", "")}`;
        await fixture.db
          .collection(`${prefix}_summary`)
          .updateMany({}, { $set: { dm_cid_count: ["synthetic-corrupt-checkpoint"] } });
        await fixture.db.command({ collMod: "patients_month_atoms", validator: {} });
        recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
          ...cut.comparisonContext,
          comparisonOnly: false,
        });
        assert.equal(recovered.generationId, rejected.generationId);
        assert.deepEqual(recovered.recovery.verifiedGroups, ["A"]);
        const during = await page(optimized, CASES[0][1]);
        assert.deepEqual(semantic(during), semantic(before));
        retainedBeforeRecovery = {
          oldSourceCutAt: CUTS[0],
          duringReadySha256: digest(semantic(during)),
          allSixRemainWhole: true,
        };
        active = await builder.publish(recovered, active);
      }
      building = false;
      const cases = [];
      for (const [name, body] of CASES) {
        const reference = await page(legacy, body);
        assert.deepEqual(comparable(await page(legacy, body)), comparable(reference));
        const actual = await page(optimized, body);
        assert.deepEqual(comparable(actual), comparable(reference), `${index + 1}/${name}`);
        assert(actual.responses.every(({ status, sourceCutAt }) => status === 200 && sourceCutAt === CUTS[index]));
        cases.push({
          name,
          request: body,
          exactStatusAndBody: true,
          combinedParsedBodiesMS: actual.combinedParsedBodiesMS,
          responses: actual.responses.map((response, position) => ({
            route: response.route,
            status: response.status,
            referenceSha256: digest(reference.responses[position].body),
            actualSha256: digest(response.body),
            sourceCutAt: response.sourceCutAt,
            state: response.state,
            parsedBodyMS: response.parsedBodyMS,
          })),
          ...(name === "full-supported-history" ? { bodies: comparable(actual) } : {}),
        });
      }
      const candidate = index === 0 ? old : recovered;
      evidence.push({
        sourceCutAt: CUTS[index],
        sourceVersion: candidate.source.sourceVersion,
        referenceSource,
        generationId: candidate.generationId,
        capturedClock: candidate.recovery.capturedClock,
        timeZone: candidate.recovery.timeZone,
        stages: candidate.inventory.stages,
        collections: candidate.inventory.collections,
        validation: candidate.validation,
        resources: candidate.resources,
        cases,
      });
    }
    assert.deepEqual(await builder.cleanup(old.generationId), { removed: [old.generationId] });
    assert.deepEqual(await builder.cleanup(old.generationId), { removed: [] });
    const control = await fixture.db
      .collection("patients_model_control")
      .findOne({ _id: "patients" }, { promoteLongs: false });
    assert.equal(control.pins.length, 0);
    assert.equal(peakHeavyOperations, 1);
    const output = {
      schema: "ticket28-recovery-report-v1",
      executionStartedAt,
      executionEndedAt: new Date().toISOString(),
      elapsedMS: monotonicClock.now() - started,
      boundary: "isolated-real-Mongo-public-Builder-and-six-HTTP",
      reference: {
        baselineRevision: BASELINE_REVISION,
        priorCorrectionEvidence: "ticket-27-fixture.json",
        sameFiniteProducerAndCases: true,
      },
      runtime: {
        node: process.version,
        driver: require("mongodb/package.json").version,
        codec: require("roaring/package.json").version,
        platform: process.platform,
        arch: process.arch,
        mongo: fixture.version,
      },
      limits: FIXTURE_BUDGET,
      failed,
      retainedBeforeRecovery,
      recovery: recovered.recovery,
      peakHeavyOperations,
      idempotentCleanup: true,
      finalControl: {
        revision: control.revision.toString(),
        fence: control.fence.toString(),
        publicationVersion: control.publicationVersion.toString(),
        occupiedSlots: control.slots.filter((slot) => slot.state !== "free").length,
        pins: control.pins.length,
        bsonBytes: BSON.serialize(control).length,
      },
      evidence,
      releaseGates: {
        productionSourceHistoryIngestion: "unverified",
        representativeCapacity: "unverified",
        targetNativePlatform: "unverified",
        targetAuthReplicaFailover: "unverified",
        arbitraryMidCommandWorkerReclaim: "retained-unsupported",
        lostSupervisorProof: "retained-unsupported",
        dashboardRenderingAndPage24Hour: "deferred-32-unverified",
        activation: "blocked-legacy-default",
      },
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await legacy?.close();
    await optimized?.close();
    cuts.forEach((cut) => cut.close());
    baseline.close();
    await fixture.close();
  }
}
main().catch((error) => {
  process.stderr.write(`${error.name}: recovery fixture report failed\n`);
  process.exitCode = 1;
});
