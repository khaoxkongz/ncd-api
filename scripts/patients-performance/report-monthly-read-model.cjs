const { performance: monotonicClock } = require("node:perf_hooks");
const { createHmac } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { sealFixture, rawDocuments, FIXTURE_BUDGET, SECRET } = require("./raw-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { createReader } = require("../../src/modules/patients/read-model/reader");
const { startApplication } = require("./application.cjs");
const { assertSameResponse } = require("./compare.cjs");

const CLOCK = "2024-01-03T00:00:00.000Z";
const PERIODS = Array.from({ length: 12 }, (_, index) => ({
  year: index < 11 ? 2023 : 2024,
  month: index < 11 ? index + 2 : 1,
}));
const ROUTES = ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];

async function capture(app) {
  const started = monotonicClock.now();
  const responses = await Promise.all(
    ROUTES.map(async (route) => {
      const started = monotonicClock.now();
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      return {
        route,
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") },
        body,
        parsedBodyElapsedMS: monotonicClock.now() - started,
      };
    })
  );
  return { responses, parsedBodiesElapsedMS: monotonicClock.now() - started };
}

async function main() {
  const connection = await openFixture();
  const fixture = sealFixture();
  const baseline = archiveBaseline();
  let legacy, optimized, mongoPath;
  try {
    const started = monotonicClock.now();
    const report = await createBuilder({ db: connection.db }).build(
      fixture.sourceCut,
      FIXTURE_BUDGET,
      fixture.comparisonContext
    );
    const buildElapsedMS = monotonicClock.now() - started;
    // Rebuild the reference independently with the accepted product pipeline
    // and its once-only finalization, rather than copying model output.
    mongoPath = path.join(fs.realpathSync(baseline.sourceRoot), "lib/mongo.js");
    require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { db: connection.db } };
    const { pipeline } = require(path.join(baseline.sourceRoot, "modules/migration/pipeline.js"));
    const raw = connection.db.collection("fixture_baseline_raw");
    await raw.insertMany(rawDocuments());
    for (const day of ["2024-01-01", "2024-01-02"]) {
      const start = new Date(day);
      await raw.aggregate(pipeline(start, new Date(start.getTime() + 86400000 - 1))).toArray();
    }
    const summaries = connection.db.collection("NCD_SUMMARY");
    for await (const row of summaries.find({})) {
      await summaries.updateOne(
        { _id: row._id },
        {
          $set: Object.fromEntries(
            report.bindings.map(({ field }) => [
              field,
              row[field].map((value) =>
                value ? createHmac("sha256", SECRET).update(value.toString()).digest("hex") : null
              ),
            ])
          ),
        }
      );
    }
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    const facts = await reader.read(
      { route: "patients-graphs/report", backendMode: "candidate-validation", clock: new Date(CLOCK), timeZone: "UTC" },
      ({ monthFacts }) => monthFacts({}, PERIODS)
    );
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot, clock: CLOCK });
    optimized = await startApplication({ db: connection.db, generationId: report.generationId, clock: CLOCK });
    const reference = await capture(legacy);
    const repeated = await capture(legacy);
    const candidate = await capture(optimized);
    for (let index = 0; index < ROUTES.length; index += 1) {
      assertSameResponse(reference.responses[index], repeated.responses[index], `${ROUTES[index]} stable baseline`);
      assertSameResponse(reference.responses[index], candidate.responses[index], ROUTES[index]);
      if (reference.responses[index].headers["content-type"] !== candidate.responses[index].headers["content-type"])
        throw new Error("Content type differs");
    }
    const safe = {
      schema: "ticket22-fixture-report-v1",
      fixtureRevision: "full-finite-raw-v1",
      evidence: "isolated-local-backend-only",
      baselineRevision: "0a1934df24b1b66a2edbe2cb3e8235a7073932a7",
      calculationClock: CLOCK,
      serverTimeZone: "UTC",
      generationId: report.generationId,
      complete: report.complete,
      components: report.components,
      sourceBytes: report.source.bytes,
      sourceRecords: report.source.records,
      sourceDigest: report.source.sha256,
      sourceCutAt: report.source.sourceCutAt,
      history: report.source.history,
      rows: report.inventory.rows,
      storedAtoms: report.inventory.storedAtoms,
      identities: report.inventory.identities,
      chunks: report.inventory.chunks,
      directories: report.inventory.directories,
      indexes: report.inventory.indexes,
      stages: report.inventory.stages,
      versions: report.versions,
      facts,
      http: candidate,
      baselineEqual: true,
      repeatedBaselineEqual: true,
      validation: report.validation,
      resources: report.resources,
      buildElapsedMS,
      build: report.build,
      mongo: connection.version,
      limits: {
        activation: "blocked",
        frontendEvidence: "deferred",
        databaseMemory: "unverified",
        productionHeadroom: "unverified",
        denseLargeBlockEvidence: "unverified",
        spending: 0,
      },
    };
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  } finally {
    await legacy?.close();
    await optimized?.close();
    if (mongoPath) delete require.cache[mongoPath];
    baseline.close();
    fixture.close();
    await connection.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
