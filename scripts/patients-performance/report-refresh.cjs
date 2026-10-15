const assert = require("node:assert/strict");
const { performance: monotonicClock } = require("node:perf_hooks");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { BASELINE_REVISION } = require("./contract-fixture.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const {
  HISTORY,
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

async function main() {
  const executionStartedAt = new Date().toISOString(),
    started = monotonicClock.now();
  const fixture = await openFixture(),
    baseline = archiveBaseline();
  const cuts = [sealRefresh(1), sealRefresh(2)];
  const failedCutAt = "2025-01-10T04:00:00.000Z";
  const rejected = sealRefresh(2, {
    sourceCutAt: failedCutAt,
    availability: {
      mutationAvailableThrough: failedCutAt,
      exportAvailableAt: failedCutAt,
      evidence: "finite-producer-availability-v1",
    },
  });
  let now,
    active = null,
    legacy,
    optimized,
    building = false,
    peakHeavyCommands = 0;
  const heavy = new Set();
  fixture.client.on("commandStarted", ({ requestId, command }) => {
    if (building && (command.aggregate || command.createIndexes)) {
      heavy.add(requestId);
      peakHeavyCommands = Math.max(peakHeavyCommands, heavy.size);
    }
  });
  for (const name of ["commandSucceeded", "commandFailed"])
    fixture.client.on(name, ({ requestId }) => heavy.delete(requestId));
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: PAGE_CLOCK });
    optimized = await startApplication({ db: fixture.db, activeGeneration: true, clock: PAGE_CLOCK });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const cycles = [];
    for (const [index, cut] of cuts.entries()) {
      const sourceInventory = await seedBaseline(fixture.db, baseline, documents(index + 1), legacy);
      now = new Date(new Date(CUTS[index]).getTime() + 60000);
      const at = monotonicClock.now();
      building = true;
      const run = await builder.refresh(
        { cutAt: CUTS[index], expectedActive: active, acquire: async () => cut.sourceCut },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      );
      building = false;
      const refreshElapsedMS = monotonicClock.now() - at;
      active = run.active;
      assert.equal(run.status, "published");
      const cases = [];
      for (const [name, body] of CASES) {
        const reference = await page(legacy, body);
        assert.deepEqual(
          comparable(await page(legacy, body)),
          comparable(reference),
          `unstable baseline ${index + 1}/${name}`
        );
        const actual = await page(optimized, body);
        assert.deepEqual(comparable(actual), comparable(reference), `different full result ${index + 1}/${name}`);
        assert(actual.responses.every(({ status, sourceCutAt }) => status === 200 && sourceCutAt === CUTS[index]));
        cases.push({ name, reference, actual, exactBodyAndStatus: true });
      }
      const candidate = run.candidate;
      cycles.push({
        cutAt: CUTS[index],
        sourceInventory,
        refreshElapsedMS,
        run: {
          runId: run.runId,
          generationId: run.generationId,
          status: run.status,
          source: run.source,
          startedAt: run.startedAt,
          acquisitionStartedAt: run.acquisitionStartedAt,
          acquiredAt: run.acquiredAt,
          buildStartedAt: run.buildStartedAt,
          publishedAt: run.publishedAt,
          ledger: run.ledger,
          events: run.events,
          cleanup: run.cleanup,
          active: run.active,
          visibility: run.visibility,
        },
        candidate: {
          complete: candidate.complete,
          state: candidate.state,
          source: candidate.source,
          versions: candidate.versions,
          components: candidate.components,
          validation: candidate.validation,
          inventory: {
            rows: candidate.inventory.rows,
            identities: candidate.inventory.identities,
            chunks: candidate.inventory.chunks,
            stages: candidate.inventory.stages,
            typeInventory: candidate.inventory.typeInventory,
            collections: candidate.inventory.collections,
          },
          resources: candidate.resources,
          build: candidate.build,
        },
        cases,
      });
    }
    const beforeFailure = await page(optimized, CASES[0][1]);
    now = new Date("2025-01-10T04:01:00.000Z");
    const failure = await builder
      .refresh(
        { cutAt: failedCutAt, expectedActive: active, acquire: async () => rejected.sourceCut },
        { ...FIXTURE_BUDGET, maxSourceBytes: 1 },
        { ...rejected.comparisonContext, comparisonOnly: false }
      )
      .catch((error) => error);
    assert(failure instanceof Error);
    assert.equal(failure.report.status, "failed");
    const afterFailure = await page(optimized, CASES[0][1]);
    assert.deepEqual(comparable(afterFailure), comparable(beforeFailure));
    assert(afterFailure.responses.every(({ sourceCutAt }) => sourceCutAt === CUTS[1]));
    assert.equal(peakHeavyCommands, 1);
    process.stdout.write(
      `${JSON.stringify({
        schema: "ticket27-fixture-report-v1",
        evidence: "isolated-real-http-and-mongodb-full-raw-correction-cycles",
        executionStartedAt,
        executionFinishedAt: new Date().toISOString(),
        elapsedMS: monotonicClock.now() - started,
        baselineRevision: BASELINE_REVISION,
        fixedHistory: HISTORY,
        pageClock: PAGE_CLOCK,
        clockEvidence:
          "Historical schedule and mutation/export times are injected signed fixture data. Elapsed durations are observed monotonic time; this is not an actual 24-hour or dashboard experiment.",
        sourceConsistency:
          "The trusted synthetic finite producer owns every record in both revisions, emits a complete BSON export, then seals and signs the full-domain statement. Counts and digests verify transport; they alone do not prove physical consistency.",
        corrections: [
          "late clinical-day arrival",
          "hospital-day replacement",
          "whole hospital-day deletion",
          "eligibility removal",
          "historical deletion and scalar correction",
          "geography move",
          "disease-membership move",
          "cross-hospital identity correction",
          "hospital and day move",
          "scalar correction with surviving membership",
        ],
        exactComparisons: {
          cuts: 2,
          casesPerCut: CASES.length,
          endpoints: 6,
          candidateResponses: 2 * CASES.length * 6,
          repeatedBaselineCaptures: true,
          approvedExpensePolicy:
            "Integer raw amounts coincide with the approved exact expense policy; existing decimal differential fixtures remain in the full suite.",
        },
        peakConcurrentRefreshAggregationOrIndexCommands: peakHeavyCommands,
        cycles,
        failedCandidate: {
          cutAt: failedCutAt,
          status: failure.report.status,
          generationId: failure.report.generationId,
          source: failure.report.source,
          ledger: failure.report.ledger,
          completedStages: failure.report.completedStages,
          failure: failure.report.failure,
          beforeFailure,
          afterFailure,
          previousWholePagePreserved: true,
        },
        runtime: {
          node: process.version,
          driver: require("mongodb/package.json").version,
          mongo: fixture.version,
          roaring: require("roaring/package.json").version,
          platform: process.platform,
          architecture: process.arch,
        },
        limits: {
          ...FIXTURE_BUDGET,
          cadenceHours: 12,
          acquisitionHours: 2,
          buildCheckAvailabilityHours: 6,
          combinedReserveHours: 4,
          ledgerBytes: 65536,
          activeBuilders: 1,
          heavyRefreshOperations: 1,
          slots: 2,
          spending: 0,
        },
        releaseGates: {
          activation: "blocked; existing legacy default remains",
          productionSourceConsistencyCoverageAndIngestion: "unverified",
          representativeFullWorkloadBudgetsAndHeadroom: "unverified",
          targetNativeRuntimeAndTopology: "unverified",
          recovery: "continued in issue28",
          dashboardAndVisible24HourEvidence: "deferred to issue32",
          schedulerAndSourceExport: "not installed",
        },
      })}\n`
    );
  } finally {
    await legacy?.close();
    await optimized?.close();
    cuts.forEach((cut) => cut.close());
    rejected.close();
    baseline.close();
    await fixture.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
