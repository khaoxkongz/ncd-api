const { BSON } = require("mongodb");
const { createHash, createHmac } = require("node:crypto");
const { createRequire } = require("node:module");
const { performance: monotonicClock } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { sealFixture, SECRET } = require("./raw-fixture.cjs");
const { PARTS } = require("./contract-fixture.cjs");

const HISTORY = Object.freeze({ start: "2023-12-31T00:00:00.000Z", end: "2025-01-08T23:59:59.999Z" });
const CUTS = ["2025-01-09T04:00:00.000Z", "2025-01-09T16:00:00.000Z"];
const PAGE_CLOCK = "2025-01-10T05:00:00.000Z";
const SNAPSHOT = { startDate: "2024-01-07", endDate: "2025-01-10", area: "", province: "", district: "", hcode: "" };
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
].map((field) => `${field}_cid_count`);

function documents(revision) {
  const row = (id, hcode, cid, diagnoses, total, extra = {}) => ({
    _id: id,
    hcode,
    hname: `Synthetic ${hcode}`,
    cid,
    transaction_uid: `service-${id}`,
    area: "A",
    province: "P",
    district: `D-${hcode}`,
    status: "accepted",
    claim_date: new Date("2025-01-07T12:00:00.000Z"),
    diag_nosis: diagnoses.map((diag) => (typeof diag === "string" ? { diag } : diag)),
    total: String(total),
    ...extra,
  });
  const result = [
    row("historic-survivor", "H0", "historic", ["E10"], revision === 1 ? 5 : 50, {
      claim_date: new Date("2023-12-31T12:00:00.000Z"),
    }),
    row("survivor-one", "H1", "survivor", ["E10", "I10"], 10),
    row("survivor-two", "H2", "survivor", ["E10"], 20),
    row(
      revision === 1 ? "replace-old" : "replace-new",
      "H4",
      revision === 1 ? "replaced" : "replacement",
      revision === 1 ? ["I10"] : ["J44"],
      revision === 1 ? 40 : 400
    ),
    row("eligibility", "H5", "ineligible", ["C34"], 50, { status: revision === 1 ? "accepted" : "reclaimed" }),
    row("geography", "H6", "geography", ["E10"], 60, {
      area: revision === 1 ? "OLD" : "NEW",
      province: revision === 1 ? "P" : "Q",
      district: revision === 1 ? "OLD-D" : "NEW-D",
    }),
    row("category", "H7", "category", revision === 1 ? ["E10"] : ["F32"], revision === 1 ? 70 : 75),
    row("scalar", "H8", "scalar", ["J44"], revision === 1 ? 80 : 800),
    row(
      "all-subtypes",
      "H10",
      "subtypes",
      [
        "E101",
        { diag: "E102", dx_type: "1" },
        { diag: "E10", dx_type: "1" },
        { diag: "I21", dx_type: "2" },
        { diag: "I63", dx_type: "2" },
        "C34",
        "C50",
        "C53",
        "C22",
        "C18",
      ],
      100
    ),
    row("null-member", "H11", null, ["I10"], 90),
    row("psy-survivor", "H16", "psy-survivor", ["F32"], 150),
    row("membership", "H13", revision === 1 ? "membership-before" : "survivor", ["E10"], 110),
    row("hospital-day-move", revision === 1 ? "H14" : "H15", "moved", ["I21"], 120, {
      claim_date: new Date(revision === 1 ? "2025-01-07T12:00:00.000Z" : "2025-01-08T12:00:00.000Z"),
    }),
  ];
  if (revision === 1) {
    result.push(row("delete-day", "H3", "deleted", ["E10"], 30));
    result.push(
      row("delete-historic", "H9", "historic-deleted", ["I10"], 7, { claim_date: new Date("2023-12-31T12:00:00.000Z") })
    );
  } else
    result.push(row("late-arrival", "H12", "late", ["E10"], 130, { claim_date: new Date("2025-01-06T12:00:00.000Z") }));
  return result;
}

function sealRefresh(revision, overrides = {}) {
  const cutAt = CUTS[revision - 1];
  const sealed = sealFixture(documents(revision), {
    manifestOverrides: {
      history: HISTORY,
      sourceCutAt: cutAt,
      sourceVersion: `full-correction-${revision}`,
      availability: {
        mutationAvailableThrough: cutAt,
        exportAvailableAt: cutAt,
        evidence: "finite-producer-availability-v1",
      },
      ...overrides,
    },
  });
  sealed.comparisonContext.supportedHistory = HISTORY;
  return sealed;
}

const FULL = { startDate: "2023-12-31", endDate: "2025-01-08T23:59:59.999Z" };
/** @type {Array<[string, Record<string, unknown>]>} */
const CASES = [
  ["full-supported-history", FULL],
  ["older-than-migration-and-current-graphs", { startDate: "2023-12-31", endDate: "2023-12-31T23:59:59.999Z" }],
  ...["H0", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H13", "H14", "H15"].map(
    (hcode) => /** @type {[string, Record<string, unknown>]} */ ([`hospital-${hcode}`, { ...FULL, hcode }])
  ),
  ["old-geography", { ...FULL, area: "OLD" }],
  ["new-geography", { ...FULL, area: "NEW" }],
  ["independent-province", { ...FULL, province: "Q" }],
  ["combined-corrected-geography", { ...FULL, district: "NEW-D", hcode: "H6" }],
  ["old-day-after-move", { startDate: "2025-01-07", endDate: "2025-01-07T23:59:59.999Z", hcode: "H14" }],
  ["new-day-after-move", { startDate: "2025-01-08", endDate: "2025-01-08T23:59:59.999Z", hcode: "H15" }],
  ["late-clinical-day", { startDate: "2025-01-06", endDate: "2025-01-06T23:59:59.999Z" }],
  ["snapshot", SNAPSHOT],
];

async function page(app, body) {
  const started = monotonicClock.now();
  const responses = await Promise.all(
    PARTS.map(async ({ route }) => {
      const at = monotonicClock.now();
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return {
        route,
        status: response.status,
        body: await response.json(),
        sourceCutAt: response.headers.get("x-ncd-source-cut"),
        state: response.headers.get("x-ncd-data-state"),
        parsedBodyMS: monotonicClock.now() - at,
      };
    })
  );
  return { body, responses, combinedParsedBodiesMS: monotonicClock.now() - started };
}

function comparable(capture) {
  return capture.responses.map(({ route, status, body }) => ({ route, status, body }));
}

async function seedBaseline(db, baseline, records, app) {
  const require = createRequire(__filename);
  const mongoPath = path.join(fs.realpathSync(baseline.sourceRoot), "lib/mongo.js");
  require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { db } };
  const { pipeline } = require(path.join(baseline.sourceRoot, "modules/migration/pipeline.js"));
  const raw = db.collection("fixture_refresh_baseline_raw"),
    summaries = db.collection("NCD_SUMMARY");
  await raw.deleteMany({});
  await summaries.deleteMany({});
  await db.collection("NCD_Summary_Temp_Table").deleteMany({});
  await raw.insertMany(records);
  const days = [...new Set(records.map(({ claim_date }) => claim_date.toISOString().slice(0, 10)))].sort((a, b) =>
    a.localeCompare(b)
  );
  // This finite producer knows the empty days. Applying the unchanged baseline
  // on each nonempty day gives the same full hospital-day output; the candidate
  // independently walks every day of the declared supported history.
  for (const day of days) {
    const start = new Date(day);
    await raw.aggregate(pipeline(start, new Date(start.getTime() + 86400000 - 1))).toArray();
  }
  for await (const row of summaries.find({}))
    await summaries.updateOne(
      { _id: row._id },
      {
        $set: Object.fromEntries(
          FIELDS.map((field) => [
            field,
            row[field].map((value) =>
              value ? createHmac("sha256", SECRET).update(value.toString()).digest("hex") : null
            ),
          ])
        ),
      }
    );
  const reference = await page(app, { startDate: "2024-01-07", endDate: PAGE_CLOCK });
  if (reference.responses.some(({ status }) => status !== 200)) throw new Error("Baseline snapshot reference failed");
  await db.collection("NCD_Summary_Temp_Table").insertOne({
    _id: "finite-refresh-reference",
    created_at: new Date(PAGE_CLOCK),
    ...Object.fromEntries(PARTS.map(({ field }, index) => [field, reference.responses[index].body.result])),
  });
  return {
    records: records.length,
    days: days.length,
    transportSha256: createHash("sha256")
      .update(Buffer.concat(records.map((row) => BSON.serialize(row))))
      .digest("hex"),
  };
}

module.exports = { HISTORY, CUTS, PAGE_CLOCK, SNAPSHOT, CASES, documents, sealRefresh, page, comparable, seedBaseline };
