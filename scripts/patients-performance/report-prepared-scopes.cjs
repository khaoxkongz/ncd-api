const { performance: timer } = require("node:perf_hooks");
const { BSON, Binary, Int32, Long, Double, Decimal128 } = require("mongodb");
const { openFixture, archiveBaseline } = require("./contract.cjs");
const { sealFixture, FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { startApplication } = require("./application.cjs");
const { assertSameResponse } = require("./compare.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");

const CLOCK = "2026-10-15T00:00:00.000Z";
const COLLATION = { locale: "en", strength: 2 };
const FIELDS = [
  "dm",
  "ht",
  "copd",
  "ca",
  "psy",
  "hd_cvd",
  "hg",
  "dm_ckd",
  "dm_acs",
  "dm_cva",
  "lung_ca",
  "breast_ca",
  "cervical_ca",
  "liver_ca",
  "colorectal_ca",
];
const ROUTES = ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const PERIODS = Array.from({ length: 12 }, (_, i) => ({ year: i < 2 ? 2025 : 2026, month: ((i + 10) % 12) + 1 }));

function documents() {
  return [
    [new Int32(2026), new Int32(10), "A", "p", "H1", ["shared", "a"]],
    [new Double(2026), new Double(10), "a", "P", "H2", ["shared", "b"]],
    [
      Long.fromInt(2026),
      Long.fromInt(10),
      7,
      "P",
      "H3",
      ["shared", null, Long.fromInt(7), Decimal128.fromString("7.00")],
    ],
    [2026, 9, "7", "P", "H1", ["shared", "c"]],
    [Decimal128.fromString("2026"), 8, "A", "P", "H5", ["invisible"]],
    [2026, 10, ["A", "C"], "Else", "H6", ["shared", "array"]],
    [2026, 10, undefined, undefined, "H7", ["missing"]],
    [2026, 10, { left: 1, right: 2 }, "Else", "H8", ["document"]],
  ].map(([year, month, area, province, hcode, members], i) => ({
    _id: `prepared-report-${i}`,
    date: new Date(`2024-01-01T00:00:00.${String(i).padStart(3, "0")}Z`),
    year,
    month,
    ...(area === undefined ? {} : { area }),
    ...(province === undefined ? {} : { province }),
    hcode,
    district: "D",
    ...Object.fromEntries(FIELDS.map((field) => [`${field}_cid_count`, members])),
  }));
}

async function capture(app, body) {
  const start = timer.now();
  const responses = await Promise.all(
    ROUTES.map(async (route) => {
      const start = timer.now();
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const parsed = await response.json();
      return {
        route,
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") },
        body: parsed,
        parsedBodyElapsedMS: timer.now() - start,
      };
    })
  );
  return { responses, parsedBodiesElapsedMS: timer.now() - start };
}

function compare(left, right) {
  for (let i = 0; i < ROUTES.length; i += 1) {
    assertSameResponse(left.responses[i], right.responses[i], ROUTES[i]);
    if (left.responses[i].headers["content-type"] !== right.responses[i].headers["content-type"])
      throw new Error("Content type differs");
  }
}

function planSummary(plan) {
  const scans = [],
    lookups = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.stage === "IXSCAN")
      scans.push({ indexName: node.indexName, keyPattern: node.keyPattern, indexBounds: node.indexBounds });
    if (node.$lookup)
      lookups.push({
        from: node.$lookup.from,
        indexesUsed: node.indexesUsed,
        collectionScans: node.collectionScans,
        totalKeysExamined: node.totalKeysExamined,
        totalDocsExamined: node.totalDocsExamined,
        nReturned: node.nReturned,
      });
    for (const [key, value] of Object.entries(node))
      if (!key.startsWith("rejected")) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
  }
  const execution = plan.executionStats ?? plan.stages?.find((stage) => stage.$cursor)?.$cursor.executionStats;
  visit(plan.queryPlanner?.winningPlan ?? plan.stages);
  return {
    nReturned: execution?.nReturned,
    totalKeysExamined: execution?.totalKeysExamined,
    totalDocsExamined: execution?.totalDocsExamined,
    executionTimeMillis: execution?.executionTimeMillis,
    scans,
    lookups,
  };
}

async function plans(db, generationId) {
  const base = {
    generationId,
    periodKind: "stored",
    graphVisible: true,
    $or: PERIODS.map(({ year, month }) => ({ storedYear: year, storedMonth: month })),
  };
  const result = [];
  for (const [name, predicates] of [
    ["stored-national", {}],
    ["stored-area", { area: "A" }],
    ["stored-combined-residuals", { area: "A", province: "P", hcode: "H1" }],
  ]) {
    const explain = await db
      .collection("patients_month_atoms")
      .find({ ...base, ...predicates })
      .collation(COLLATION)
      .explain("executionStats");
    result.push({ name, predicates: Object.keys(predicates), ...planSummary(explain) });
  }
  const query = {
    generationId,
    scopeKind: "area",
    value: { $eq: "A" },
    predicateKey: new Binary(BSON.serialize({ area: "A" })),
  };
  const scopes = db.collection("patients_scopes");
  result.push({
    name: "exact-typed-scope-lookup",
    ...planSummary(await scopes.find(query).collation(COLLATION).explain("executionStats")),
  });
  const scope = await scopes.findOne(query, { collation: COLLATION });
  result.push({
    name: "prepared-scope-periods",
    ...planSummary(
      await db
        .collection("patients_month_scopes")
        .find({ ...base, scopeId: scope.scopeId })
        .collation(COLLATION)
        .explain("executionStats")
    ),
  });
  const atom = await db.collection("patients_month_atoms").findOne({ ...base, area: "A" }, { collation: COLLATION });
  result.push({
    name: "set-category-chunks",
    ...planSummary(
      await db
        .collection("patients_bitmap_chunks")
        .find({ generationId, setId: atom.rowId, category: "DM" })
        .collation(COLLATION)
        .sort({ block: 1, chunkNo: 1 })
        .explain("executionStats")
    ),
  });
  // The Reader's atom stream starts at the complete typed partition selection,
  // then looks up generation/set chunks. Record the actual compound-index use.
  result.push({
    name: "atom-selection-and-chunk-lookup",
    ...planSummary(
      await db
        .collection("patients_month_atoms")
        .aggregate(
          [
            { $match: { ...base, area: "A", province: "P" } },
            {
              $lookup: {
                from: "patients_bitmap_chunks",
                localField: "rowId",
                foreignField: "setId",
                pipeline: [
                  {
                    $match: {
                      generationId,
                      category: {
                        $in: [
                          "DM",
                          "HT",
                          "COPD",
                          "CA",
                          "PSY",
                          "HD_CVD",
                          "DM_HG",
                          "DM_CKD",
                          "DM_ACS",
                          "DM_CVA",
                          "CA_LUNG",
                          "CA_BREAST",
                          "CA_CERVICAL",
                          "CA_LIVER",
                          "CA_COLORECTAL",
                        ],
                      },
                    },
                  },
                ],
                as: "parts",
              },
            },
            { $unwind: "$parts" },
          ],
          { collation: COLLATION, allowDiskUse: false }
        )
        .explain("executionStats")
    ),
  });
  return result;
}

async function main() {
  const local = await openFixture(),
    baseline = archiveBaseline();
  const rows = documents(),
    fixture = sealFixture(rows, { dataset: "summary-fixture", collation: COLLATION });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").drop();
    await local.db.createCollection("NCD_SUMMARY", { collation: COLLATION });
    await local.db.collection("NCD_SUMMARY").createIndex({ date: 1 });
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const started = timer.now();
    const builder = createBuilder({ db: local.db });
    const candidate = await builder.build(fixture.sourceCut, FIXTURE_BUDGET, fixture.comparisonContext);
    const buildElapsedMS = timer.now() - started;
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock: CLOCK });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock: CLOCK });
    const scenarios = [];
    for (const [id, prepared, atom] of [
      ["national", {}, { area: { $nin: ["absent"] } }],
      ["independent-area-collation", { area: "A" }, { area: { $eq: "A" } }],
      ["province-across-areas", { province: "P" }, { province: { $eq: "P" } }],
      ["combined-residuals", { area: "A", province: "P" }, { area: { $eq: "A" }, province: { $eq: "P" } }],
    ]) {
      const reference = await capture(legacy, prepared);
      compare(reference, await capture(legacy, prepared));
      const conditions = [];
      for (const [path, app, body] of [
        ["baseline", legacy, prepared],
        [id === "combined-residuals" ? "combined-atoms" : "prepared", optimized, prepared],
        ["atoms", optimized, atom],
      ]) {
        const warmups = [];
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const response = await capture(app, body);
          compare(reference, response);
          warmups.push({ attempt, fullCorrect: true, parsedBodiesElapsedMS: response.parsedBodiesElapsedMS });
        }
        const loads = [];
        let example;
        for (let attempt = 1; attempt <= 20; attempt += 1) {
          const started = timer.now();
          try {
            const response = await capture(app, body);
            compare(reference, response);
            example ??= response.responses;
            loads.push({
              attempt,
              fullCorrect: true,
              effectiveDurationMS: response.parsedBodiesElapsedMS,
              endpoints: response.responses.map(({ route, parsedBodyElapsedMS }) => ({ route, parsedBodyElapsedMS })),
            });
          } catch (error) {
            loads.push({
              attempt,
              fullCorrect: false,
              effectiveDurationMS: "Infinity",
              observedElapsedMS: timer.now() - started,
              error: error.name,
            });
          }
        }
        const ordered = loads
          .map(({ effectiveDurationMS }) => (effectiveDurationMS === "Infinity" ? Infinity : effectiveDurationMS))
          .sort((a, b) => a - b);
        const p95 = ordered[Math.ceil(0.95 * loads.length) - 1];
        conditions.push({
          path,
          trial: "later",
          excludedWarmups: warmups,
          attempts: loads.length,
          correct: loads.filter(({ fullCorrect }) => fullCorrect).length,
          nearestRankP95MS: Number.isFinite(p95) ? p95 : "Infinity",
          example,
          loads,
        });
      }
      scenarios.push({ id, predicates: { prepared, atom }, repeatedBaselineEqual: true, conditions });
    }
    let publicationRejected = false;
    try {
      await builder.publish(candidate, null);
    } catch {
      publicationRejected = true;
    }
    const evidence = {
      schema: "ticket23-prepared-scopes-report-v1",
      evidence: "isolated-local-three-graph-exploration",
      fixtureRevision: "typed-collated-geography-v1",
      baselineRevision: "0a1934df24b1b66a2edbe2cb3e8235a7073932a7",
      calculationClock: CLOCK,
      serverTimeZone: "UTC",
      collation: COLLATION,
      generationId: candidate.generationId,
      complete: candidate.complete,
      components: candidate.components,
      source: {
        records: candidate.source.records,
        bytes: candidate.source.bytes,
        sha256: candidate.source.sha256,
        sourceCutAt: candidate.source.sourceCutAt,
        history: candidate.source.history,
        dataset: candidate.source.dataset,
        rawComplete: candidate.source.rawComplete,
      },
      inventory: candidate.inventory,
      versions: candidate.versions,
      validation: candidate.validation,
      plans: await plans(local.db, candidate.generationId),
      legacyIndexes: await local.db.collection("NCD_SUMMARY").listIndexes().toArray(),
      resources: candidate.resources,
      buildElapsedMS,
      build: candidate.build,
      mongo: local.version,
      scenarios,
      publicationRejected,
      limits: {
        spending: 0,
        loads: "20 exploratory three-graph loads per path and scenario; one active load",
        retainedResponseCache: false,
        coldProcessEvidence: false,
        pageAcceptance: "unmet",
        sixEndpointAcceptance: "unmet",
        frontend: "deferred",
        sourceCapacity: "unverified",
        databaseMemory: "unverified",
        productionHeadroom: "unverified",
        activation: "blocked",
        concurrentHostWork: "other isolated fixture tasks may be active",
      },
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (scenarios.some(({ conditions }) => conditions.some(({ correct }) => correct !== 20))) process.exitCode = 1;
  } finally {
    await legacy?.close();
    await optimized?.close();
    fixture.close();
    baseline.close();
    await local.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
