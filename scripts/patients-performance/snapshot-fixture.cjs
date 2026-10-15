const { sealFixture, rawDocuments } = require("./raw-fixture.cjs");

const SNAPSHOT_CLOCK = "2024-01-09T05:00:00.000Z";
const SNAPSHOT_HISTORY = { start: "2024-01-07T00:00:00.000Z", end: "2024-01-08T23:59:59.999Z" };
const SNAPSHOT_REQUEST = {
  startDate: "2024-01-07",
  endDate: "2024-01-09",
  area: "",
  province: "",
  district: "",
  hcode: "",
};

function sealSnapshotFixture(documents, options = {}) {
  const records =
    documents ??
    rawDocuments().map((document) => ({
      ...document,
      claim_date: new Date(document.claim_date.getTime() + 6 * 86400000),
    }));
  const fixture = sealFixture(records, {
    ...options,
    manifestOverrides: { history: SNAPSHOT_HISTORY, sourceCutAt: SNAPSHOT_CLOCK, ...options.manifestOverrides },
  });
  fixture.comparisonContext.supportedHistory = options.manifestOverrides?.history ?? SNAPSHOT_HISTORY;
  return fixture;
}

module.exports = { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST };
