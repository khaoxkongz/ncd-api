const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { BSON } = require("mongodb");
const { createHash, randomUUID } = require("node:crypto");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { PARTS, BASELINE_REVISION } = require("./contract-fixture.cjs");
const { compareResponses } = require("./compare.cjs");
const { startApplication } = require("./application.cjs");
const { sealRefresh, documents, seedBaseline, PAGE_CLOCK, FULL, SNAPSHOT } = (() => {
  const refresh = require("./refresh-fixture.cjs");
  return { ...refresh, FULL: refresh.CASES[0][1] };
})();
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder.js");
const { policy } = require("./capacity-fixture.cjs");
const { ACTOR } = require("../../src/modules/patients/read-model/capacity.js");
const { LIMITS } = require("./loads.cjs");

// Capture unchanged controllers from the pinned archive, before candidate
// construction. Query-error verification belongs to candidate telemetry only;
// these successful repeated legacy bodies do not claim driver-error coverage.
async function referencePage(app, bodyBytes) {
  return Promise.all(
    PARTS.map(async ({ route }) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyBytes,
        signal: AbortSignal.timeout(65000),
      });
      return { route, status: response.status, body: await response.json() };
    })
  );
}
function expectedHeaders(sourceCutAt, state) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-ncd-source-cut": sourceCutAt,
    "x-ncd-data-state": state,
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "X-NCD-Source-Cut, X-NCD-Data-State",
  };
}
function fixtureScenario(condition, source) {
  const fixtureDigest = createHash("sha256")
    .update(Buffer.concat(documents(1).map((document) => BSON.serialize(document))))
    .digest("hex");
  const exactSource =
    source.sha256 === fixtureDigest &&
    source.sourceVersion === "full-correction-1" &&
    source.records === 15 &&
    source.sourceCutAt === "2025-01-09T04:00:00.000Z";
  const known = [
    {
      id: "finite-full-supported-history",
      body: FULL,
      families: [
        "date-ranges",
        "cid-reuse",
        "card-calculations",
        "bar-calculations",
        "disease-total",
        "dm-ca-other",
        "all-fifteen-bindings",
        "independent-card-services-and-hospitals",
        "response-shape-and-order",
      ],
    },
    {
      id: "finite-selected-snapshot",
      body: SNAPSHOT,
      families: ["stored-snapshots", "snapshot-source-provenance", "response-shape-and-order"],
    },
  ].find((item) => item.id === condition.scenario && JSON.stringify(item.body) === condition.requestBytes);
  return exactSource && known ? known.families : [];
}
async function openLoadFixture(phase) {
  const connection = await openFixture(),
    baseline = archiveBaseline(),
    cut = sealRefresh(1);
  let legacy, candidate;
  const budget = { ...FIXTURE_BUDGET, maxStorageBytes: FIXTURE_BUDGET.maxStorageBytes - LIMITS.artifactBytes };
  try {
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot, clock: PAGE_CLOCK });
    const baselineInventory = await seedBaseline(connection.db, baseline, documents(1), legacy);
    const scenarios = [
      { id: "finite-full-supported-history", routing: "live", body: FULL },
      { id: "finite-selected-snapshot", routing: "snapshot", body: SNAPSHOT },
    ];
    const references = [];
    for (const scenario of scenarios) {
      const bodyBytes = JSON.stringify(scenario.body);
      const first = await referencePage(legacy, bodyBytes),
        second = await referencePage(legacy, bodyBytes);
      if (first.some((response, index) => response.status !== 200 || !compareResponses(response, second[index]).equal))
        throw new Error("Independent fixture reference is failed or unstable");
      references.push({ ...scenario, bodyBytes, reference: first });
    }
    await legacy.close();
    legacy = undefined;
    const capacity = policy([cut]);
    const builder = createBuilder({ db: connection.db, clock: () => new Date(PAGE_CLOCK), timeZone: "UTC", capacity });
    candidate = await builder.build(cut.sourceCut, budget, { ...cut.comparisonContext, comparisonOnly: false });
    await builder.publish(candidate, null);
    const conditions = references.flatMap((scenario) =>
      ["first", "later"].map((trial) => ({
        id: `${scenario.id}-${trial}`,
        scenario: scenario.id,
        trial,
        routing: scenario.routing,
        requestBytes: scenario.bodyBytes,
        reference: scenario.reference.map((response) => ({
          ...response,
          headers: expectedHeaders("2025-01-09T04:00:00.000Z", "stale"),
        })),
      }))
    );
    const referenceBytes = JSON.stringify(
      references.map(({ id, bodyBytes, reference }) => ({ id, bodyBytes, reference }))
    );
    const plan = {
      scope: "isolated-fixture",
      phase,
      clock: PAGE_CLOCK,
      timeZone: "UTC",
      source: BSON.deserialize(cut.sourceCut.manifest),
      generation: {
        id: candidate.generationId,
        seal: candidate.seal,
        versions: candidate.versions,
        buildCapacity: candidate.resources.capacity,
        fixedModelBudget: budget,
      },
      reference: {
        baselineRevision: BASELINE_REVISION,
        repeated: "exactly equal",
        sha256: createHash("sha256").update(referenceBytes).digest("hex"),
        legacyQueryErrors: "not-independently-verified-by-application-harness",
        baselineInventory,
        arithmetic: "integer-fixture-agrees-with-unchanged-baseline; expense-v1 edge goldens remain separate",
      },
      conditions,
    };
    return {
      plan,
      candidate,
      openApplication: () =>
        startApplication({
          db: connection.db,
          activeGeneration: true,
          clock: PAGE_CLOCK,
          capacityFactory: (actor) => ({
            ...policy([cut], {
              processes: [
                { id: "builder", ...ACTOR, roles: ["builder", "api"] },
                { id: "api", ...actor, roles: ["api"] },
              ],
            }),
            processId: "api",
          }),
        }),
      async close({ safe = true } = {}) {
        baseline.close();
        if (safe) {
          cut.close();
          await connection.close();
          return { removed: true };
        }
        // Unknown work keeps the actual model/source/pins, even after a child
        // exited. Only the independent fixture client is disconnected here.
        await connection.client.close();
        return {
          removed: false,
          database: connection.db.databaseName,
          sourceDirectory: path.dirname(cut.sourceCut.filename),
          reason: "dependent-work-unverified",
        };
      },
    };
  } catch (error) {
    // Preparation can fail after a command was dispatched or publication may
    // have committed. A failed promise is not deletion authority. Keep the
    // source and namespace for independent recovery, even on an early failure.
    await legacy?.close().catch(() => {});
    baseline.close();
    await connection.client.close().catch(() => {});
    const receipt = path.join(os.tmpdir(), `patients-load-preparation-${randomUUID()}.json`);
    fs.writeFileSync(
      receipt,
      `${JSON.stringify({ version: "retained-load-preparation-v1", database: connection.db.databaseName, sourceDirectory: path.dirname(cut.sourceCut.filename), generationId: candidate?.generationId ?? error.generationId ?? null, reason: "preparation-settlement-unverified", observedError: /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : "Error" })}\n`,
      { mode: 0o600, flag: "wx" }
    );
    const failure = new Error(`Fixture preparation failed; private retention receipt: ${receipt}`);
    failure.receipt = receipt;
    throw failure;
  }
}
module.exports = { openLoadFixture, referencePage, expectedHeaders, fixtureScenario };
