const { performance: monotonicClock } = require("node:perf_hooks");
const { openFixture } = require("./contract.cjs");
const { sealFixture, FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { createReader } = require("../../src/modules/patients/read-model/reader");
const { startApplication } = require("./application.cjs");

async function main() {
  const connection = await openFixture();
  const fixture = sealFixture();
  const started = monotonicClock.now();
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      fixture.sourceCut,
      FIXTURE_BUDGET,
      fixture.comparisonContext
    );
    const buildElapsedMS = monotonicClock.now() - started;
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    const facts = await reader.read(
      {
        route: "patients-bar/report",
        backendMode: "candidate-validation",
        clock: new Date("2024-01-03T00:00:00Z"),
        timeZone: "UTC",
      },
      ({ rangeFacts }) => rangeFacts({ date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } })
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const request = { startDate: "2024-01-01", endDate: "2024-01-02" };
    const httpStart = monotonicClock.now();
    const response = await fetch(`${app.url}/ncds_api/api/v1/bar-chart-pt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await response.json();
    const http = {
      route: "/ncds_api/api/v1/bar-chart-pt",
      request,
      status: response.status,
      body,
      parsedBodyElapsedMS: monotonicClock.now() - httpStart,
    };
    const safe = {
      schema: "ticket19-fixture-report-v1",
      fixtureRevision: "full-finite-raw-v1",
      evidence: "isolated-local-only",
      sourceBytes: report.source.bytes,
      sourceRecords: report.source.records,
      sourceDigest: report.source.sha256,
      sourceCutAt: report.source.sourceCutAt,
      history: report.source.history,
      rows: report.inventory.rows,
      identities: report.inventory.identities,
      chunks: report.inventory.chunks,
      directories: report.inventory.directories,
      stages: report.inventory.stages,
      counts: facts.counts,
      services: facts.services,
      matchedRows: facts.matchedRows,
      http,
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
        spending: 0,
      },
    };
    process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
  } finally {
    await app?.close();
    fixture.close();
    await connection.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}\n`);
  process.exitCode = 1;
});
