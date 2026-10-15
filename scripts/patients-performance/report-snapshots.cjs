const { performance: monotonicClock } = require("node:perf_hooks");
const { isDeepStrictEqual } = require("node:util");
const { openFixture } = require("./contract.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } = require("./snapshot-fixture.cjs");
const { startApplication } = require("./application.cjs");
const { BASELINE_REVISION } = require("./contract-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");

const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];

async function capture(app, request) {
  const combined = monotonicClock.now();
  const responses = await Promise.all(
    ROUTES.map(async (route) => {
      const started = monotonicClock.now();
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://fixture.invalid" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      return {
        route: `/ncds_api/api/v1/${route}`,
        status: response.status,
        headers: Object.fromEntries(
          [
            "content-type",
            "x-ncd-source-cut",
            "x-ncd-data-state",
            "cache-control",
            "access-control-expose-headers",
          ].map((name) => [name, response.headers.get(name)])
        ),
        body,
        parsedBodyElapsedMS: monotonicClock.now() - started,
      };
    })
  );
  return { request, responses, combinedParsedBodiesMS: monotonicClock.now() - combined };
}

async function main() {
  const connection = await openFixture();
  const fixture = sealSnapshotFixture();
  let app;
  try {
    const started = monotonicClock.now();
    const report = await createBuilder({
      db: connection.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(fixture.sourceCut, FIXTURE_BUDGET, fixture.comparisonContext);
    const buildElapsedMS = monotonicClock.now() - started;
    app = await startApplication({ db: connection.db, generationId: report.generationId, clock: SNAPSHOT_CLOCK });
    const snapshot = await capture(app, SNAPSHOT_REQUEST);
    const live = await capture(app, { startDate: "2024-01-07", endDate: "2024-01-08" });
    if (
      !snapshot.responses.every(
        ({ status, body }, index) =>
          status === 200 && live.responses[index].status === 200 && isDeepStrictEqual(body, live.responses[index].body)
      )
    )
      throw new Error("Snapshot/live fixture mismatch");
    await app.close();
    app = await startApplication({
      db: connection.db,
      generationId: report.generationId,
      clock: "2024-01-11T05:00:00.001Z",
    });
    const staleRequest = { ...SNAPSHOT_REQUEST, endDate: "2024-01-11" };
    const stale = await capture(app, staleRequest);
    if (
      !stale.responses.every(
        ({ status, body, headers }, index) =>
          status === 200 &&
          headers["x-ncd-data-state"] === "stale" &&
          headers["x-ncd-source-cut"] === SNAPSHOT_CLOCK &&
          isDeepStrictEqual(body, snapshot.responses[index].body)
      )
    )
      throw new Error("Stale snapshot provenance mismatch");
    await connection.db.collection("patients_snapshots").deleteMany({ generationId: report.generationId });
    const missing = await capture(app, staleRequest);
    if (
      !missing.responses.every(
        ({ status, body }) =>
          status === 503 && isDeepStrictEqual(body, { status: false, message: "Read model unavailable" })
      )
    )
      throw new Error("Missing snapshot did not fail explicitly");
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "ticket25-fixture-report-v1",
          fixtureRevision: "full-finite-snapshot-raw-v1",
          baselineRevision: BASELINE_REVISION,
          evidence: "isolated-local-backend-only",
          sourceBytes: report.source.bytes,
          sourceRecords: report.source.records,
          sourceDigest: report.source.sha256,
          sourceCutAt: report.source.sourceCutAt,
          history: report.source.history,
          versions: report.versions,
          candidate: { complete: report.complete, state: report.state, components: report.components },
          inventory: {
            rows: report.inventory.rows,
            storedAtoms: report.inventory.storedAtoms,
            chunks: report.inventory.chunks,
            snapshotDocuments: report.inventory.snapshotDocuments,
          },
          snapshotValidation: report.validation.snapshots,
          snapshot,
          live,
          stale,
          missing,
          resources: report.resources,
          buildElapsedMS,
          build: report.build,
          mongo: connection.version,
          limits: {
            activation: "blocked",
            frontendEvidence: "deferred-to-issue-32",
            frontendIssue: "https://github.com/khaoxkongz/ncd-api/issues/32",
            pageTiming: "unverified",
            productionHeadroom: "unverified",
            databaseMemory: "unverified",
            spending: 0,
          },
        },
        null,
        2
      )}\n`
    );
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
