const assert = require("node:assert/strict");
const { performance: monotonicClock } = require("node:perf_hooks");
const { BSON } = require("mongodb");
const { openFixture } = require("./contract.cjs");
const { rawDocuments, FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } = require("./snapshot-fixture.cjs");
const { startApplication } = require("./application.cjs");
const { openTransport } = require("./mongo-transport.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");

const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const CLOCK = "2024-01-11T00:00:00.000Z";
const REQUEST = { ...SNAPSHOT_REQUEST, endDate: "2024-01-11" };
async function capture(app) {
  const started = monotonicClock.now();
  const responses = await Promise.all(
    ROUTES.map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://fixture.invalid" },
        body: JSON.stringify(REQUEST),
      });
      const body = await response.json();
      return {
        route: `/ncds_api/api/v1/${route}`,
        status: response.status,
        headers: Object.fromEntries(
          ["x-ncd-source-cut", "x-ncd-data-state", "cache-control", "access-control-expose-headers"].map((name) => [
            name,
            response.headers.get(name),
          ])
        ),
        body,
      };
    })
  );
  return { responses, combinedParsedBodiesMS: monotonicClock.now() - started };
}

async function main() {
  const fixture = await openFixture();
  const transport = await openTransport();
  const first = sealSnapshotFixture();
  const documents = rawDocuments().map((row) => ({
    ...row,
    claim_date: new Date(row.claim_date.getTime() + 6 * 86400000),
  }));
  documents.push({ ...documents[0], _id: "new-raw-row", cid: "new-patient", transaction_uid: "new-service" });
  const second = sealSnapshotFixture(documents, {
    manifestOverrides: { sourceVersion: "corrected-cut-v2", sourceCutAt: "2024-01-10T00:00:00.000Z" },
  });
  let app, pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, {
      ...first.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(old, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: CLOCK, transportUri: transport.uri });
    const before = await capture(app);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, {
      ...second.comparisonContext,
      comparisonOnly: false,
    });
    // The real command is forwarded, then its reply is held. Pinning precedes
    // this first generation-descriptor read; publication can now retire it.
    const reached = transport.arm((command) => command.find === "patients_generations");
    pending = capture(app);
    await reached;
    const control = fixture.db.collection("patients_model_control");
    const pinned = await control.findOne({ _id: "patients" }, { promoteLongs: false });
    assert(pinned.pins.some((pin) => pin.generationId === old.generationId));
    const next = await builder.publish(candidate, active);
    await assert.rejects(builder.cleanup(old.generationId), /owned|blocked/);
    transport.release();
    const during = await pending;
    const after = await capture(app);
    const identities = during.responses.map((response, index) => {
      const reference = response.headers["x-ncd-source-cut"] === SNAPSHOT_CLOCK ? before : after;
      assert.deepEqual(response, reference.responses[index]);
      assert.equal(response.status, 200);
      return reference === before ? "old" : "new";
    });
    assert(identities.includes("old"));
    assert.equal(before.responses[0].body.result[0].patient_count, 6);
    assert.equal(after.responses[0].body.result[0].patient_count, 7);
    assert(before.responses.every((response) => response.headers["x-ncd-data-state"] === "stale"));
    assert(after.responses.every((response) => response.headers["x-ncd-data-state"] === "fresh"));
    const removed = await builder.cleanup(old.generationId);
    assert.deepEqual(removed, { removed: [old.generationId] });
    const final = await control.findOne({ _id: "patients" }, { promoteLongs: false });
    assert.deepEqual(final.pins, []);
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "ticket26-fixture-report-v1",
          evidence: "isolated-local-real-http-mongo-wire-publication",
          mongo: fixture.version,
          calculationClock: CLOCK,
          request: REQUEST,
          candidates: [old, candidate].map((report) => ({
            generationId: report.generationId,
            complete: report.complete,
            state: report.state,
            sourceCutAt: report.source.sourceCutAt,
            records: report.source.records,
            seal: report.seal,
            components: report.components,
            collections: report.inventory.collections,
            build: report.build,
            resources: report.resources,
          })),
          publication: { before: active, after: next, responseGenerations: identities },
          control: {
            version: final.version,
            revision: final.revision.toString(),
            publicationVersion: final.publicationVersion.toString(),
            fence: final.fence.toString(),
            bsonBytes: BSON.serialize(final).length,
            occupiedSlots: final.slots.filter((slot) => slot.state !== "free").length,
            pins: final.pins.length,
            observedPinnedBeforePublication: pinned.pins.length,
            deletingWasBlockedByPin: true,
            removedRetiredGeneration: removed.removed.length === 1,
          },
          before,
          during,
          after,
          limits: {
            requestBudgetMS: 60000,
            heartbeatMS: 15000,
            leaseMS: 120000,
            maxPins: 64,
            maxControlBsonBytes: 1048576,
            maxOccupiedSlots: 2,
            activation: "blocked",
            frontendEvidence: "deferred-to-issue-32",
            frontendIssue: "https://github.com/khaoxkongz/ncd-api/issues/32",
            targetTopologyTermination: "unverified-suspect-protection-retained",
            targetNativeRuntime: "unverified",
            representativeHeadroomAndLatency: "unverified",
            spending: 0,
          },
        },
        null,
        2
      )}\n`
    );
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
