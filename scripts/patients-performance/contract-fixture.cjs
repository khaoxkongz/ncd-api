const { BSON, ObjectId, Long, Decimal128, Double } = require("mongodb");
const { createHash } = require("node:crypto");
const { generateWorkload, ARRAY_FIELDS, HOSPITALS } = require("./generate.cjs");
const { buildCases, NORMAL_CLOCK, NORMAL_TIME_ZONE } = require("./cases.cjs");

const PARTS = Object.freeze([
  { id: "card", route: "card", field: "card_summary" },
  { id: "bar", route: "bar-chart-pt", field: "chart_patient" },
  { id: "expense", route: "bar-chart-ex", field: "chart_expense" },
  { id: "disease", route: "graph-disease-pt", field: "disease_patient" },
  { id: "dm", route: "graph-dm-pt", field: "dm_patient" },
  { id: "ca", route: "graph-ca-pt", field: "ca_patient" },
]);
const BASELINE_REVISION = "0a1934df24b1b66a2edbe2cb3e8235a7073932a7";
const HARNESS_REVISION = "81cefd954478cea912a5635f928b3ca839e01271";
const MAIN = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"];
const DISEASE_LABELS = [
  "โรคเบาหวาน",
  "โรคความดันโลหิตสูง",
  "โรคปอดอุดกั้นเรื้อรัง",
  "โรคมะเร็ง",
  "สุขภาพจิต",
  "โรคหัวใจและหลอดเลือด",
];
const EMPTY_GEO = { area: "", province: "", district: "", hcode: "" };
const RANGE = { startDate: "2023-01-01", endDate: "2026-10-13" };
const digest = (data) => createHash("sha256").update(data).digest("hex");

function row(identity, overrides = {}) {
  const result = {
    _id: new ObjectId(digest(identity).slice(0, 24)),
    ...HOSPITALS[0],
    date: new Date("2026-10-01T00:00:00.000Z"),
    year: 2026,
    month: 10,
  };
  for (const field of ARRAY_FIELDS) result[field] = [];
  for (const disease of MAIN) {
    result[`${disease}_expense`] = 0;
    result[`${disease}_uid_count`] = 0;
  }
  return Object.assign(result, overrides);
}

function snapshots() {
  const series = (labels) =>
    labels.map((diseaseName, category) => ({
      diseaseName,
      data: Array.from({ length: 12 }, (_, month) => category * 20 + month + 1),
    }));
  return [
    {
      _id: "patients-contract-snapshot-first-v1",
      created_at: new Date("2025-10-13T05:00:00.000Z"),
      card_summary: [
        { service_count: 101, patient_count: 7, expense: 12.34, hcode_count: 3, avg_service: 14.43, avg_expense: 1.76 },
      ],
      chart_patient: DISEASE_LABELS.map((diseaseName, index) => ({ diseaseName, qtyOfPatient: index + 1, avg: 1.25 })),
      chart_expense: DISEASE_LABELS.map((diseaseName, index) => ({
        diseaseName,
        qtyOfExpense: index + 1.25,
        avg: 0.75,
      })),
      disease_patient: series(["ทั้งหมด", ...DISEASE_LABELS]),
      dm_patient: series([
        "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
        "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
        "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
        "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
        "เบาหวานชนิดอื่น ๆ",
      ]),
      ca_patient: series([
        "โรคมะเร็งปอด",
        "โรคมะเร็งเต้านม",
        "โรคมะเร็งปากมดลูก",
        "โรคมะเร็งตับ",
        "โรคมะเร็งลำไส้ใหญ่",
        "โรคมะเร็งชนิดอื่น ๆ",
      ]),
    },
  ];
}

function createFixture() {
  const workload = generateWorkload({ generatorRevision: BASELINE_REVISION });
  const fixtures = {
    normal: workload.documents,
    empty: [],
    "empty-patients": [row("empty-patients", { dm_uid_count: 4, dm_expense: 1.005 })],
    "typed-values": [
      row("typed-number", {
        area: 1,
        province: "FIX-P",
        dm_cid_count: [
          42,
          Long.fromNumber(42),
          new Double(42),
          Decimal128.fromString("42"),
          null,
          "42",
          { kind: "synthetic" },
          ["synthetic"],
        ],
        dm_uid_count: 13,
        dm_expense: 2.675,
      }),
      row("typed-string", {
        area: "1",
        province: "FIX-P",
        hcode: "FIX-H2",
        dm_cid_count: [42, null, "typed-second"],
        ht_cid_count: [42],
        dm_uid_count: 2,
        dm_expense: 1.005,
      }),
      row("historical-move", {
        area: "HIST-A",
        province: "HIST-P",
        district: "HIST-D",
        date: new Date("2023-06-01T00:00:00Z"),
        year: 2023,
        month: 6,
        dm_cid_count: [42],
        dm_uid_count: 1,
        dm_expense: -1.005,
      }),
    ],
    "stored-periods": [
      row("stored-date-disagreement", {
        date: new Date("2024-02-29T00:00:00Z"),
        year: 2026,
        month: 10,
        dm_cid_count: ["stored-a"],
        ht_cid_count: ["stored-a"],
        dm_uid_count: 1,
      }),
      row("stored-typed-period", { year: "2026", month: "10", dm_cid_count: ["stored-b"], dm_uid_count: 1 }),
    ],
    "nullable-arrays": [row("nullable-array", { dm_cid_count: null, ht_cid_count: [null], ht_uid_count: 2 })],
    "missing-array": [row("missing-array", { ht_cid_count: ["missing-a"], ht_uid_count: 2 })],
    "formatting-error": [
      row("decimal-legacy-format", {
        dm_cid_count: ["format-a"],
        dm_uid_count: 1,
        dm_expense: Decimal128.fromString("1.005"),
      }),
    ],
    "expense-ties": [
      row("expense-ties", {
        dm_cid_count: ["ties-a"],
        ht_cid_count: ["ties-a", "ties-b"],
        ca_cid_count: ["ties-c"],
        dm_expense: 1.005,
        ht_expense: 2.675,
        ca_expense: -1.005,
        copd_expense: 12.345,
        psy_expense: 0.004,
        hd_cvd_expense: 0.004,
      }),
    ],
  };
  delete fixtures["missing-array"][0].dm_cid_count;
  const cases = buildCases(workload.fixtures);
  const add = (id, variant, body = RANGE, extra = {}) =>
    cases.push({
      id,
      variant,
      body,
      clock: NORMAL_CLOCK,
      timeZone: NORMAL_TIME_ZONE,
      families: ["fixed-fixture", "response-shape-and-order"],
      ...extra,
    });
  add("typed-identity-equivalence", "typed-values");
  add("typed-numeric-area", "typed-values", { ...RANGE, area: 1 });
  add("typed-string-area", "typed-values", { ...RANGE, area: "1" });
  add("conflicting-independent-geography", "typed-values", { ...RANGE, area: 1, hcode: "FIX-H2" });
  add("independent-province-without-area", "typed-values", { ...RANGE, province: "FIX-P" });
  add("historical-geography-before-2024", "typed-values", { ...RANGE, province: "HIST-P" });
  add("stored-period-date-disagreement", "stored-periods", { startDate: "2024-02-29", endDate: "2024-02-29" });
  for (const variant of ["nullable-arrays", "missing-array", "formatting-error", "expense-ties"]) add(variant, variant);
  for (const { label, value } of [
    { label: "invalid", value: "not-a-date" },
    { label: "null", value: null },
    { label: "numeric-zero", value: 0 },
    { label: "false", value: false },
    { label: "array", value: ["2026-10-01"] },
    { label: "object", value: {} },
  ]) {
    add(`date-input-${label}`, "normal", { startDate: value, endDate: "2026-10-13" });
  }
  add("date-input-omitted", "normal", {});
  add("reversed-dates", "normal", { startDate: "2026-10-13", endDate: "2024-01-01" });
  add(
    "snapshot-failed-aggregation",
    "snapshot-valid",
    { startDate: "2024-01-07", endDate: "2026-10-13", ...EMPTY_GEO },
    { fault: "controller" }
  );
  for (const variant of [
    "snapshot-multiple",
    "snapshot-empty-fields",
    "snapshot-null-fields",
    "snapshot-missing-fields",
  ]) {
    add(variant, variant, { startDate: "2024-01-07", endDate: "2026-10-13", ...EMPTY_GEO });
  }
  return { fixtures, cases, snapshots: snapshots(), profileId: `${workload.manifest.profileId}-six-endpoint-v1` };
}

function sourceDigest(fixture) {
  const hash = createHash("sha256");
  for (const [name, documents] of Object.entries(fixture.fixtures)) {
    hash.update(name);
    for (const document of documents) hash.update(BSON.serialize(document));
  }
  for (const document of fixture.snapshots) hash.update(BSON.serialize(document));
  return hash.digest("hex");
}

module.exports = { BASELINE_REVISION, HARNESS_REVISION, PARTS, createFixture, sourceDigest };
