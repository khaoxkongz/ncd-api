const { performance: monotonicClock } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const { openFixture } = require("./contract.cjs");
const { sealRange } = require("./date-range-fixture.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { BASELINE_REVISION } = require("./contract-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { createReader } = require("../../src/modules/patients/read-model/reader");
const { startApplication } = require("./application.cjs");

function summarizePlan(explanation) {
  const stages = new Set(),
    indexes = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.stage) stages.add(value.stage);
    if (value.indexName) indexes.add(value.indexName);
    for (const child of Object.values(value)) visit(child);
  }
  visit(explanation.queryPlanner?.winningPlan);
  return {
    stages: [...stages],
    indexes: [...indexes],
    returned: explanation.executionStats?.nReturned,
    examinedDocuments: explanation.executionStats?.totalDocsExamined,
    examinedKeys: explanation.executionStats?.totalKeysExamined,
    executionTimeMS: explanation.executionStats?.executionTimeMillis,
  };
}

function summarizeAggregate(explanation) {
  const roots = [],
    lookups = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.$cursor) roots.push(summarizePlan(value.$cursor));
    if (value.$lookup && value.indexesUsed)
      lookups.push({
        from: value.$lookup.from,
        indexes: value.indexesUsed,
        collectionScans: Number(value.collectionScans),
        examinedDocuments: Number(value.totalDocsExamined),
        examinedKeys: Number(value.totalKeysExamined),
        returned: Number(value.nReturned),
      });
    for (const child of Object.values(value)) visit(child);
  }
  visit(explanation);
  return { roots, lookups };
}

async function main() {
  const connection = await openFixture();
  const cut = sealRange();
  let app;
  try {
    const started = monotonicClock.now();
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    const buildElapsedMS = monotonicClock.now() - started;
    const generationId = report.generationId;
    const scope = await connection.db.collection("patients_scopes").findOne({ generationId, scopeKind: "national" });
    const month = await connection.db
      .collection("patients_date_month_scopes")
      .findOne({ generationId, scopeId: scope.scopeId, monthStart: new Date("2024-01-01") });
    const full = { monthStart: { $gte: new Date("2024-01-01") }, monthEnd: { $lte: new Date("2025-03-01") } };
    const queries = [
      [
        "UTC-date historical metadata, one independent field",
        "patients_date_month_atoms",
        { generationId, hcode: "H1", ...full },
      ],
      [
        "UTC-date prepared national metadata",
        "patients_date_month_scopes",
        { generationId, scopeId: scope.scopeId, ...full },
      ],
      [
        "Original daily service accumulator selection",
        "patients_daily",
        { generationId, date: { $gte: new Date("2024-01-01"), $lte: new Date("2025-03-01") }, area: "old" },
      ],
      ["Selected portable chunks", "patients_bitmap_chunks", { generationId, setId: month.rowId, category: "CARD" }],
      [
        "Selected independent directory",
        "patients_bitmap_directory",
        { generationId, setId: month.rowId, category: "CARD" },
      ],
    ];
    const queryEvidence = [];
    for (const [purpose, collection, match] of queries) {
      const explanation = await connection.db
        .collection(collection)
        .find(match, { collation: cut.comparisonContext.collation ?? { locale: "simple" } })
        .explain("executionStats");
      queryEvidence.push({ purpose, collection, ...summarizePlan(explanation) });
    }
    const observed = [];
    const monitoredDb = {
      collection(name) {
        const collection = connection.db.collection(name);
        return new Proxy(collection, {
          get(target, property) {
            if (property === "aggregate")
              return (pipeline, options) => {
                if (pipeline.some((stage) => stage.$unionWith)) observed.push({ name, pipeline, options });
                return target.aggregate(pipeline, options);
              };
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    await createReader({ db: monitoredDb, generationId, validationOnly: true }).read(
      {
        route: "card/report-plans",
        backendMode: "candidate-validation",
        clock: new Date("2025-04-01"),
        timeZone: "UTC",
      },
      ({ rangeFacts }) => rangeFacts({ date: { $gte: new Date("2024-01-01"), $lte: new Date("2025-03-01") } })
    );
    const readerPlanEvidence = [];
    for (const operation of observed) {
      const explanation = await connection.db
        .collection(operation.name)
        .aggregate(operation.pipeline, operation.options)
        .explain("executionStats");
      readerPlanEvidence.push({ collection: operation.name, ...summarizeAggregate(explanation) });
    }
    app = await startApplication({ db: connection.db, generationId });
    const http = [];
    for (const request of [
      { startDate: "2024-01-01", endDate: "2025-03-01" },
      { startDate: "2024-01-15T12:00:00.001Z", endDate: "2025-02-15T12:30:00.000Z" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "new", hcode: "H1" },
    ])
      for (const route of ["card", "bar-chart-pt", "bar-chart-ex"]) {
        const started = monotonicClock.now();
        const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        const body = await response.json();
        http.push({
          route: `/ncds_api/api/v1/${route}`,
          request,
          status: response.status,
          body,
          responseBytes: Buffer.byteLength(JSON.stringify(body)),
          parsedBodyElapsedMS: monotonicClock.now() - started,
        });
      }
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "ticket24-fixture-report-v1",
          fixtureRevision: "date-range-finite-summary-v1",
          baselineRevision: BASELINE_REVISION,
          candidateRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          evidence: "single-isolated-local-summary-fixture-only",
          sourceRecords: report.source.records,
          sourceBytes: report.source.bytes,
          sourceDigest: report.source.sha256,
          sourceCutAt: report.source.sourceCutAt,
          history: report.source.history,
          versions: report.versions,
          inventories: {
            rows: report.inventory.rows,
            dateUtc: report.inventory.dateUtc,
            storedAtoms: report.inventory.storedAtoms,
            scopes: report.inventory.scopes,
            storedScopePeriods: report.inventory.storedScopePeriods,
            identities: report.inventory.identities,
            chunks: report.inventory.chunks,
            directories: report.inventory.directories,
          },
          validation: report.validation,
          indexes: report.inventory.indexes,
          queryEvidence,
          readerPlanEvidence,
          http,
          resources: report.resources,
          buildElapsedMS,
          stages: report.inventory.stages,
          build: report.build,
          mongo: connection.version,
          candidate: { state: report.state, complete: report.complete, components: report.components },
          limits: {
            spending: 0,
            activation: "blocked",
            frontendEvidence: "deferred",
            targetHost: "unverified",
            sourceHistoryAndCapacity: "unverified",
            databaseMemoryAndCpuIo: "unverified",
            servicePath: "original daily Mongo accumulators; monthly membership and expense facts",
          },
        },
        null,
        2
      )}\n`
    );
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
