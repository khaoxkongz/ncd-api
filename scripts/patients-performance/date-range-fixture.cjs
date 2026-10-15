const { sealFixture } = require("./raw-fixture.cjs");

const FIELDS = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"];
const HISTORY = { start: "2023-12-01T00:00:00.000Z", end: "2025-03-31T23:59:59.999Z" };

function rangeRow(id, date, overrides = {}) {
  return {
    _id: id,
    date: new Date(date),
    year: 2026,
    month: 10,
    hcode: "H1",
    area: "old",
    province: "P",
    district: "D",
    ...Object.fromEntries(
      FIELDS.flatMap((field) => [
        [`${field}_cid_count`, []],
        [`${field}_uid_count`, 0],
        [`${field}_expense`, 0],
      ])
    ),
    dm_cid_count: ["shared"],
    dm_uid_count: 1,
    dm_expense: 10,
    ...overrides,
  };
}

function rangeRows() {
  return [
    rangeRow("before", "2023-12-31T23:59:59.999Z"),
    rangeRow("jan-start", "2024-01-01T00:00:00.000Z"),
    rangeRow("jan-middle", "2024-01-15T12:00:00.001Z", { dm_cid_count: ["shared", "second"] }),
    rangeRow("jan-end", "2024-01-31T23:59:59.999Z", { hcode: "H2", area: 7, district: "D2" }),
    rangeRow("feb-start", "2024-02-01T00:00:00.000Z", { dm_cid_count: [], ht_cid_count: ["shared"], ht_uid_count: 2 }),
    rangeRow("leap-start", "2024-02-29T00:00:00.000Z", { area: "new" }),
    rangeRow("leap-end", "2024-02-29T23:59:59.999Z", { area: "new", dm_cid_count: ["third"] }),
    rangeRow("march-start", "2024-03-01T00:00:00.000Z", { area: "new" }),
    rangeRow("year-end", "2024-12-31T23:59:59.999Z", { hcode: "H2", area: 7, dm_cid_count: ["fourth"] }),
    rangeRow("year-start", "2025-01-01T00:00:00.000Z", { area: "new", province: "P2" }),
    rangeRow("late", "2025-02-15T12:30:00.000Z", { hcode: "H2", area: 7, dm_cid_count: ["fifth"] }),
    rangeRow("scalar-only", "2025-03-01T00:00:00.000Z", {
      hcode: "H3",
      dm_cid_count: [],
      dm_uid_count: 8,
      dm_expense: 30,
    }),
    rangeRow("after", "2025-03-31T23:59:59.999Z", { dm_cid_count: ["after"] }),
  ];
}

function sealRange(documents = rangeRows(), options = {}) {
  const cut = sealFixture(documents, {
    dataset: "summary-fixture",
    ...options,
    manifestOverrides: { history: HISTORY, sourceCutAt: "2025-04-01T00:00:00.000Z", ...options.manifestOverrides },
  });
  cut.comparisonContext.supportedHistory = HISTORY;
  return cut;
}

module.exports = { FIELDS, HISTORY, rangeRow, rangeRows, sealRange };
