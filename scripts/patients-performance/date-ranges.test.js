import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealRange, rangeRows, rangeRow } from "./date-range-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";
import { Binary } from "mongodb";
import { createHash } from "node:crypto";
import { RoaringBitmap32 } from "roaring";

const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex"];
async function post(app, route, body) {
  const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

it("answers all three range routes across full UTC months and exact daily edges without changing stored graph months", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const rows = rangeRows();
  const cut = sealRange(rows);
  let app, legacy;
  try {
    const builder = createBuilder({ db: connection.db });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    expect(report.components.monthlyDateUtc.complete).toBe(true);
    expect(report.inventory.dateUtc.atoms).toBeGreaterThan(0);
    expect(report.validation.monthlyDateUtc.equal).toBe(true);
    expect(report.complete).toBe(false);
    await expect(builder.publish(report.generationId)).rejects.toThrow(/incomplete/);
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    const clock = "2026-10-15T12:00:00.000Z";
    app = await startApplication({ db: connection.db, generationId: report.generationId, clock });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot, clock });
    const selections = [
      { startDate: "2023-12-01", endDate: "2025-03-31T23:59:59.999Z" },
      { startDate: "2024-01-01", endDate: "2025-03-01" },
      { startDate: "2024-01-15T12:00:00.001Z", endDate: "2025-02-15T12:30:00.000Z" },
      { startDate: "2024-02-01", endDate: "2024-02-29" },
      { startDate: "2024-02-29T00:00:00.001Z", endDate: "2024-02-29T23:59:59.999Z" },
      { startDate: "2024-01-01T07:00:00+07:00", endDate: "2024-03-01T06:59:59.999+07:00" },
      { startDate: "2024-12-31T23:59:59.999Z", endDate: "2025-01-01" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: 7 },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "7" },
      { startDate: "2024-01-01", endDate: "2025-03-01", province: "P2" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "old", hcode: "H1" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "new", hcode: "H2" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: { $in: ["old", 7] }, district: "D" },
    ];
    for (const selection of selections)
      for (const route of ROUTES) {
        const reference = await post(legacy, route, selection);
        expect(await post(legacy, route, selection)).toEqual(reference);
        expect(await post(app, route, selection)).toEqual(reference);
      }
    for (const route of ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"])
      expect(await post(app, route, { area: "old" })).toEqual(await post(legacy, route, { area: "old" }));
    expect((await post(app, "graph-disease-pt", { area: "old" })).body.result[1].data.at(-1)).toBe(3);
  } finally {
    await app?.close();
    await legacy?.close();
    cut.close();
    baseline.close();
    await connection.close();
  }
}, 60000);

it("keeps collated and array-valued historical geography equivalent on prepared and conjunctive exact paths", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const collation = { locale: "en", strength: 2 };
  const rows = [
    rangeRow("old-one", "2024-01-01", { area: "Move" }),
    rangeRow("old-two", "2024-01-02", { hcode: "h1", area: "move", dm_cid_count: ["second"] }),
    rangeRow("array", "2024-02-03", { hcode: "H2", area: ["MOVE", "next"], district: ["D", "D2"] }),
    rangeRow("numeric", "2024-05-01", { area: 7, dm_cid_count: ["numeric"] }),
  ];
  const cut = sealRange(rows, { collation });
  let app, legacy;
  try {
    await connection.db.collection("NCD_SUMMARY").drop();
    await connection.db.createCollection("NCD_SUMMARY", { collation });
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    for (const scope of [
      {},
      { area: "Move" },
      { area: "move" },
      { area: "MOVE" },
      { area: "next" },
      { area: ["MOVE", "next"] },
      { district: "D2" },
      { area: "Move", hcode: "H2" },
      { area: "next", province: "P" },
      { area: { $in: ["move", 7] }, hcode: { $in: ["H1", "H2"] } },
    ])
      for (const route of ROUTES) {
        const selection = { startDate: "2024-01-01", endDate: "2025-03-01", ...scope };
        expect(await post(app, route, selection)).toEqual(await post(legacy, route, selection));
      }
  } finally {
    await app?.close();
    await legacy?.close();
    cut.close();
    baseline.close();
    await connection.close();
  }
}, 60000);

it("rejects changed prepared-month directories even when replacement chunks preserve their cardinality", async () => {
  const connection = await openFixture();
  const cut = sealRange();
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    const scope = await connection.db
      .collection("patients_scopes")
      .findOne({ generationId: report.generationId, scopeKind: "national" });
    const atom = await connection.db
      .collection("patients_date_month_scopes")
      .findOne({ generationId: report.generationId, scopeId: scope.scopeId, monthStart: new Date("2024-02-01") });
    const chunks = connection.db.collection("patients_bitmap_chunks"),
      directory = connection.db.collection("patients_bitmap_directory");
    const filter = { generationId: report.generationId, setId: atom.rowId, category: "CARD" };
    const original = await chunks.findOne(filter, { promoteLongs: false });
    const originalDirectory = await directory.findOne(filter, { promoteLongs: false });
    const replacement = new RoaringBitmap32();
    for (let offset = 1234; offset < 1234 + original.popcount; offset += 1) replacement.add(offset);
    const payload = replacement.serialize("portable");
    replacement.dispose();
    const changes = { checksum: createHash("sha256").update(payload).digest("hex"), length: payload.length };
    await chunks.updateOne({ _id: original._id }, { $set: { ...changes, payload: new Binary(payload) } });
    await directory.updateOne({ _id: originalDirectory._id }, { $set: changes });
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const selection = { startDate: "2024-01-01", endDate: "2025-03-01" };
    try {
      for (const route of ROUTES)
        expect(await post(app, route, selection)).toEqual({
          status: 503,
          body: { status: false, message: "Read model unavailable" },
        });
    } finally {
      await chunks.replaceOne({ _id: original._id }, original);
      await directory.replaceOne({ _id: originalDirectory._id }, originalDirectory);
    }
    expect((await post(app, "card", selection)).status).toBe(200);
    const metadata = connection.db.collection("patients_date_month_scopes");
    const sealed = await metadata.findOne({ _id: atom._id }, { promoteValues: false, promoteLongs: false });
    for (const changes of [
      { "expenses.0.coefficient": "999" },
      { matchedRows: 99 },
      { "members.HOSPITAL.cardinality": 99 },
    ]) {
      await metadata.updateOne({ _id: atom._id }, { $set: changes });
      try {
        expect((await post(app, "card", selection)).status).toBe(503);
      } finally {
        await metadata.replaceOne({ _id: atom._id }, sealed);
      }
    }
    const daily = connection.db.collection("patients_daily");
    const serviceRow = await daily.findOne(
      { generationId: report.generationId, date: new Date("2024-01-01") },
      { promoteValues: false, promoteLongs: false }
    );
    for (const changes of [{ "card.service": 999 }, { dm_uid_count: 999 }]) {
      await daily.updateOne({ _id: serviceRow._id }, { $set: changes });
      try {
        for (const route of ROUTES) expect((await post(app, route, selection)).status).toBe(503);
        for (const route of ROUTES)
          expect(
            (await post(app, route, { startDate: "2024-01-01", endDate: "2024-01-01T00:00:00.001Z" })).status
          ).toBe(503);
      } finally {
        await daily.replaceOne({ _id: serviceRow._id }, serviceRow);
      }
    }
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("matches daily-only complete route responses for non-month-equivalent source dates and sparse Card operands", async () => {
  const connection = await openFixture();
  const rows = [
    ...rangeRows(),
    rangeRow("null-member", "2024-04-01", { dm_cid_count: [null], dm_expense: -1.005, area: "special" }),
    rangeRow("sparse", "2024-05-01", {
      dm_cid_count: ["sparse"],
      ht_cid_count: null,
      dm_uid_count: null,
      area: "special",
    }),
    // Keep this live-path data error before the existing snapshot start; a
    // required snapshot error must reject the candidate under ticket #25.
    rangeRow("service-error", "2024-01-05", { ht_uid_count: "unsupported-add", area: "service-error" }),
  ];
  const direct = sealRange(rows);
  const daily = sealRange(rows.map((row) => ({ ...row, date: [row.date] })));
  let monthlyApp, dailyApp;
  try {
    const builder = createBuilder({ db: connection.db });
    const monthlyReport = await builder.build(direct.sourceCut, FIXTURE_BUDGET, direct.comparisonContext);
    const dailyReport = await builder.build(daily.sourceCut, FIXTURE_BUDGET, daily.comparisonContext);
    expect(dailyReport.inventory.dateUtc.dailyOnlyRows).toBe(rows.length);
    expect(dailyReport.inventory.dateUtc.atoms).toBe(0);
    monthlyApp = await startApplication({ db: connection.db, generationId: monthlyReport.generationId });
    dailyApp = await startApplication({ db: connection.db, generationId: dailyReport.generationId });
    for (const selection of [
      { startDate: "2023-12-01", endDate: "2025-03-31T23:59:59.999Z" },
      { startDate: "2024-01-15T12:00:00.001Z", endDate: "2025-02-15T12:30:00.000Z" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "special" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: 7, hcode: "H2" },
      { startDate: "2024-01-01", endDate: "2025-03-01", area: "service-error" },
      { startDate: "2024-01-01", endDate: "2025-03-01", hcode: "H2" },
    ])
      for (const route of ROUTES)
        expect(await post(monthlyApp, route, selection)).toEqual(await post(dailyApp, route, selection));
  } finally {
    await monthlyApp?.close();
    await dailyApp?.close();
    direct.close();
    daily.close();
    await connection.close();
  }
}, 60000);

it("unions prepared date scopes before counting and adds unrounded monthly and daily expenses exactly once", async () => {
  const connection = await openFixture();
  const rows = [
    rangeRow("first", "2024-01-01", { dm_expense: 0.004, dm_uid_count: 2 }),
    rangeRow("repeat", "2024-01-16", { hcode: "H2", area: 7, dm_expense: 0.004, dm_uid_count: 3 }),
    rangeRow("other-disease", "2024-02-01", {
      dm_cid_count: [],
      dm_uid_count: 0,
      dm_expense: 0,
      ht_cid_count: ["second"],
      ht_uid_count: 2,
      ht_expense: 0.004,
    }),
    rangeRow("scalar", "2024-03-01", { hcode: "H3", dm_cid_count: [], dm_uid_count: 5, dm_expense: 0.004 }),
  ];
  const cut = sealRange(rows);
  const repartitioned = sealRange(rows.map((row, index) => ({ ...row, dm_expense: index === 0 ? 0.012 : 0 })));
  let app, repartitionedApp;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    expect(report.components.preparedDateUtc.complete).toBe(true);
    expect(report.inventory.dateUtc.scopes).toBeGreaterThan(1);
    expect(report.validation.preparedDateUtc.equal).toBe(true);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const selection = { startDate: "2024-01-01", endDate: "2025-03-01" };
    expect((await post(app, "card", selection)).body.result).toEqual([
      { service_count: 12, patient_count: 2, expense: 0.02, hcode_count: 3, avg_service: 6, avg_expense: 0.01 },
    ]);
    expect(
      (await post(app, "bar-chart-pt", selection)).body.result.map(({ qtyOfPatient, avg }) => [qtyOfPatient, avg])
    ).toEqual([
      [1, 10],
      [1, 2],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(
      (await post(app, "bar-chart-ex", selection)).body.result.map(({ qtyOfExpense, avg }) => [qtyOfExpense, avg])
    ).toEqual([
      [0.01, 0.01],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const scopes = [
      { area: "old" },
      { hcode: "H2" },
      { province: "P" },
      { district: "D" },
      { area: "old", province: "P" },
      { area: 7, province: "P" },
    ];
    for (const scope of scopes) {
      const single = await post(app, "card", { ...selection, ...scope });
      const exact = await post(app, "card", { ...selection, ...scope, district: { $eq: "D" } });
      expect(single).toEqual(exact);
    }
    const repartitionedReport = await createBuilder({ db: connection.db }).build(
      repartitioned.sourceCut,
      FIXTURE_BUDGET,
      repartitioned.comparisonContext
    );
    repartitionedApp = await startApplication({ db: connection.db, generationId: repartitionedReport.generationId });
    for (const route of ROUTES)
      expect(await post(repartitionedApp, route, selection)).toEqual(await post(app, route, selection));
  } finally {
    await app?.close();
    await repartitionedApp?.close();
    cut.close();
    repartitioned.close();
    await connection.close();
  }
}, 60000);
