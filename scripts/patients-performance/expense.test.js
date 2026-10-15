import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { sealFixture, rawDocuments, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { Decimal128, Double, Int32, Long, Binary } from "mongodb";

const FIELDS = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"];

const LABELS = ["โรคเบาหวาน", "โรคความดันโลหิตสูง", "โรคปอดอุดกั้นเรื้อรัง", "โรคมะเร็ง", "สุขภาพจิต", "โรคหัวใจและหลอดเลือด"];
const RANGE = { startDate: "2024-01-01", endDate: "2024-01-02" };
const CONTEXT = {
  route: "expense-bar/validation",
  backendMode: "candidate-validation",
  clock: new Date("2024-01-03"),
  timeZone: "UTC",
};

function row(id, overrides = {}) {
  return {
    _id: id,
    date: new Date("2024-01-01"),
    year: 2024,
    month: 1,
    area: "A",
    province: "P",
    district: "D",
    hcode: id,
    ...Object.fromEntries(
      FIELDS.flatMap((field) => [
        [`${field}_cid_count`, []],
        [`${field}_uid_count`, 0],
        [`${field}_expense`, 0],
      ])
    ),
    ...overrides,
  };
}

async function post(app, route, body = RANGE) {
  const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

it("reads both existing Bar payloads from the same immutable raw cut without changing successful field types", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    expect(await post(app, "bar-chart-ex")).toEqual({
      status: 200,
      body: {
        status: true,
        message: "success",
        result: [
          { diseaseName: LABELS[0], qtyOfExpense: 100, avg: 50 },
          { diseaseName: LABELS[1], qtyOfExpense: 10, avg: 10 },
          { diseaseName: LABELS[2], qtyOfExpense: 50, avg: 50 },
          { diseaseName: LABELS[3], qtyOfExpense: 60, avg: 60 },
          { diseaseName: LABELS[4], qtyOfExpense: 70, avg: 70 },
          { diseaseName: LABELS[5], qtyOfExpense: 80, avg: 80 },
        ],
      },
    });
    expect((await post(app, "bar-chart-pt")).body.result).toEqual([
      { diseaseName: LABELS[0], qtyOfPatient: 2, avg: 2 },
      { diseaseName: LABELS[1], qtyOfPatient: 1, avg: 1 },
      { diseaseName: LABELS[2], qtyOfPatient: 1, avg: 1 },
      { diseaseName: LABELS[3], qtyOfPatient: 1, avg: 1 },
      { diseaseName: LABELS[4], qtyOfPatient: 1, avg: 1 },
      { diseaseName: LABELS[5], qtyOfPatient: 1, avg: 1 },
    ]);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("retains the decimal text of the baseline ETL Double instead of restoring precision already lost", async () => {
  const connection = await openFixture();
  const cut = sealFixture(
    rawDocuments()
      .slice(0, 2)
      .map((document, index) => ({
        ...document,
        total: index ? "0.2" : "0.1",
      }))
  );
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    expect(report.validation.expenseBar.totals[0]).toEqual({ coefficient: "30000000000000004", scale: 17 });
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    expect((await post(app, "bar-chart-ex")).body.result[0]).toEqual({
      diseaseName: LABELS[0],
      qtyOfExpense: 0.3,
      avg: 0.3,
    });
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("matches baseline expense HTTP selections for arbitrary inclusive dates and independent typed geography", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    row("H1", { dm_cid_count: ["one"], dm_expense: 10 }),
    row("H2", {
      date: new Date("2024-01-02T12:00:00Z"),
      area: 2,
      province: "P2",
      district: "D2",
      dm_cid_count: ["one", "two"],
      dm_expense: 20,
    }),
    row("scalar", { dm_expense: 7 }),
  ];
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let app, legacy;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    for (const selection of [
      {},
      { area: "A" },
      { province: "P2" },
      { district: "D2" },
      { hcode: "H2" },
      { area: "A", province: "P2" },
      { area: "A", hcode: "H2" },
      { area: 2, province: "P2", district: "D2", hcode: "H2" },
      { area: 2 },
      { area: "2" },
      { area: { $in: ["A", 2] } },
      { area: ["A"] },
      { area: false },
      { area: 0 },
      { area: "0" },
      { area: "" },
      { area: null },
      { area: " " },
      { startDate: "2024-01-01T00:00:00.001Z" },
      { startDate: "2024-01-02T12:00:00.000Z", endDate: "2024-01-02T12:00:00.000Z" },
      { endDate: "2024-01-02T11:59:59.999Z" },
      { startDate: "2023-02-28", endDate: "2025-03-01" },
      { startDate: "invalid" },
      { startDate: null },
      { startDate: false },
      { startDate: 0 },
      { startDate: ["2024-01-01"] },
      { startDate: {} },
      { startDate: undefined },
      { endDate: undefined },
      { startDate: { toString: null } },
      { endDate: { toString: null } },
      { startDate: "2026-01-01" },
      { startDate: "2024-01-02", endDate: "2024-01-01" },
    ]) {
      const body = { ...RANGE, ...selection };
      expect(await post(app, "bar-chart-ex", body), JSON.stringify(selection)).toEqual(
        await post(legacy, "bar-chart-ex", body)
      );
    }
  } finally {
    await app?.close();
    await legacy?.close();
    baseline.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps baseline ignored expense values and empty memberships while rejecting non-finite and unsafe final numbers", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    ...[null, "1.005", [1.005], { value: 1.005 }, false, new Binary(Buffer.from([1])), new Date("2024-01-01")].map(
      (dm_expense, index) => row(`ignored-${index}`, { dm_cid_count: ["same"], dm_expense })
    ),
    row("missing", { dm_cid_count: ["same"] }),
    row("scalar", { dm_expense: 7 }),
  ];
  delete rows[7].dm_expense;
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let app, legacy;
  try {
    const builder = createBuilder({ db: connection.db });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    const observed = await post(app, "bar-chart-ex");
    expect(observed).toEqual(await post(legacy, "bar-chart-ex"));
    expect(observed.body.result[0]).toEqual({ diseaseName: LABELS[0], qtyOfExpense: 7, avg: 7 });
    expect((await post(app, "bar-chart-ex", { ...RANGE, hcode: "scalar" })).body.result[0]).toEqual({
      diseaseName: LABELS[0],
      qtyOfExpense: 7,
      avg: 0,
    });
    expect(report.inventory.expense.bsonKinds).toMatchObject({
      null: 1,
      string: 1,
      array: 1,
      object: 1,
      bool: 1,
      binData: 1,
      date: 1,
      missing: 1,
    });
    for (const [dm_expense, dm_cid_count] of [
      [new Double(Number.NaN), []],
      [new Double(Number.POSITIVE_INFINITY), []],
      [new Double(Number.NEGATIVE_INFINITY), []],
      [Decimal128.fromString("NaN"), []],
      [Decimal128.fromString("Infinity"), []],
      [Decimal128.fromString("-Infinity"), []],
      [Decimal128.fromString("90071992547409.93"), []],
      [Decimal128.fromString("9007199254740991"), ["one", "two", "three"]],
    ]) {
      const invalid = sealFixture([row("invalid", { dm_expense, dm_cid_count })], { dataset: "summary-fixture" });
      try {
        await expect(builder.build(invalid.sourceCut, FIXTURE_BUDGET, invalid.comparisonContext)).rejects.toThrow(
          /expense|serialization/
        );
      } finally {
        invalid.close();
      }
    }
    const empty = sealFixture([]);
    let emptyApp;
    try {
      const report = await builder.build(empty.sourceCut, FIXTURE_BUDGET, empty.comparisonContext);
      emptyApp = await startApplication({ db: connection.db, generationId: report.generationId });
      expect((await post(emptyApp, "bar-chart-ex")).body.result).toEqual(
        LABELS.map((diseaseName) => ({ diseaseName, qtyOfExpense: 0, avg: 0 }))
      );
      await connection.db.collection("patients_snapshots").deleteMany({ generationId: report.generationId });
      expect(
        await post(emptyApp, "bar-chart-ex", {
          startDate: "2024-01-07",
          endDate: "2024-01-03",
          area: false,
          province: 0,
          district: "",
          hcode: "",
        })
      ).toEqual({ status: 503, body: { status: false, message: "Read model unavailable" } });
    } finally {
      await emptyApp?.close();
      empty.close();
    }
  } finally {
    await app?.close();
    await legacy?.close();
    baseline.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps exact totals and final ratios unchanged when the same 0.004 operands are repartitioned across days", async () => {
  const connection = await openFixture();
  try {
    for (const daily of [
      [{ dm: 0.008, ht: 0.004, ca: -0.01 }],
      [
        { dm: 0.004, ht: 0.002, ca: -0.005 },
        { dm: 0.004, ht: 0.002, ca: -0.005 },
      ],
      Array.from({ length: 4 }, () => ({ dm: 0.002, ht: 0.001, ca: -0.0025 })),
    ]) {
      const cut = sealFixture(
        daily.map(({ dm, ht, ca }, index) =>
          row(`partition-${index}`, {
            date: new Date(index % 2 ? "2024-01-02" : "2024-01-01"),
            dm_cid_count: ["one", "two"],
            ht_cid_count: ["one", "two"],
            ca_cid_count: ["one", "two"],
            dm_expense: dm,
            ht_expense: ht,
            ca_expense: ca,
          })
        ),
        { dataset: "summary-fixture" }
      );
      let app;
      try {
        const report = await createBuilder({ db: connection.db }).build(
          cut.sourceCut,
          FIXTURE_BUDGET,
          cut.comparisonContext
        );
        app = await startApplication({ db: connection.db, generationId: report.generationId });
        expect((await post(app, "bar-chart-ex")).body.result).toEqual([
          { diseaseName: LABELS[0], qtyOfExpense: 0.01, avg: 0 },
          { diseaseName: LABELS[1], qtyOfExpense: 0, avg: 0 },
          { diseaseName: LABELS[2], qtyOfExpense: 0, avg: 0 },
          { diseaseName: LABELS[3], qtyOfExpense: -0.01, avg: -0.01 },
          { diseaseName: LABELS[4], qtyOfExpense: 0, avg: 0 },
          { diseaseName: LABELS[5], qtyOfExpense: 0, avg: 0 },
        ]);
        expect(report.validation.expenseBar.totals).toEqual([
          { coefficient: "8", scale: 3 },
          { coefficient: "4", scale: 3 },
          { coefficient: "0", scale: 0 },
          { coefficient: "-1", scale: 2 },
          { coefficient: "0", scale: 0 },
          { coefficient: "0", scale: 0 },
        ]);
      } finally {
        await app?.close();
        cut.close();
      }
    }
  } finally {
    await connection.close();
  }
}, 60000);

it("rejects changed exact expense facts as an explicit HTTP 503 and recovers after the failed read settles", async () => {
  const connection = await openFixture();
  const cut = sealFixture([row("integrity", { dm_cid_count: ["one"], dm_expense: new Double(1.005) })], {
    dataset: "summary-fixture",
  });
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const daily = connection.db.collection("patients_daily");
    const original = await daily.findOne({ generationId: report.generationId });
    for (const changes of [
      { "expenses.0.coefficient": "9005" },
      { "expenses.0.coefficient": "unsupported" },
      { "expenses.0.scale": -1 },
      { expenseVersion: "unknown" },
      { expenses: [] },
    ]) {
      await daily.updateOne({ _id: original._id }, { $set: changes });
      try {
        expect(await post(app, "bar-chart-ex")).toEqual({
          status: 503,
          body: { status: false, message: "Read model unavailable" },
        });
      } finally {
        await daily.replaceOne({ _id: original._id }, original);
      }
      expect((await post(app, "bar-chart-ex")).body.result[0]).toEqual({
        diseaseName: LABELS[0],
        qtyOfExpense: 1.01,
        avg: 1.01,
      });
    }
    await connection.db
      .collection("patients_generations")
      .updateOne({ _id: report.generationId }, { $set: { "components.expenseBar.complete": false } });
    expect(await post(app, "bar-chart-ex")).toEqual({
      status: 503,
      body: { status: false, message: "Read model unavailable" },
    });
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps finite BSON operands exact through cancellation and rounds the unrounded expense and patient ratio once", async () => {
  const connection = await openFixture();
  const cut = sealFixture(
    [
      row("extreme-positive", { dm_expense: Decimal128.fromString("1E+6144") }),
      row("smallest", { dm_expense: Decimal128.fromString("1E-6176") }),
      row("extreme-negative", { dm_expense: Decimal128.fromString("-1E+6144") }),
      row("golden", {
        dm_cid_count: ["one"],
        dm_expense: new Double(1.005),
        ht_cid_count: ["one", "two"],
        ht_expense: Decimal128.fromString("2.675"),
        copd_expense: Decimal128.fromString("12.345"),
        ca_cid_count: ["one"],
        ca_expense: Decimal128.fromString("-1.005"),
        psy_cid_count: ["one"],
        psy_expense: Decimal128.fromString("0.004"),
        hd_cvd_cid_count: ["one"],
        hd_cvd_expense: Decimal128.fromString("0.004"),
      }),
      row("integers", { area: "B", dm_expense: Long.fromString("9007199254740993"), ht_expense: new Int32(-7) }),
      row("integer-cancel", { area: "B", dm_expense: Long.fromString("-9007199254740992"), ht_expense: new Int32(7) }),
    ],
    { dataset: "summary-fixture" }
  );
  let app;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const expected = [
      { diseaseName: LABELS[0], qtyOfExpense: 1.01, avg: 1.01 },
      { diseaseName: LABELS[1], qtyOfExpense: 2.68, avg: 1.34 },
      { diseaseName: LABELS[2], qtyOfExpense: 12.35, avg: 0 },
      { diseaseName: LABELS[3], qtyOfExpense: -1.01, avg: -1.01 },
      { diseaseName: LABELS[4], qtyOfExpense: 0, avg: 0 },
      { diseaseName: LABELS[5], qtyOfExpense: 0, avg: 0 },
    ];
    expect(await post(app, "bar-chart-ex", { ...RANGE, area: "A" })).toEqual({
      status: 200,
      body: { status: true, message: "success", result: expected },
    });
    expect((await post(app, "bar-chart-ex")).body.result).toEqual([
      { diseaseName: LABELS[0], qtyOfExpense: 2.01, avg: 2.01 },
      ...expected.slice(1),
    ]);
    expect((await post(app, "bar-chart-ex", { ...RANGE, area: "B" })).body.result[0]).toEqual({
      diseaseName: LABELS[0],
      qtyOfExpense: 1,
      avg: 0,
    });
    expect(await post(app, "bar-chart-ex", { ...RANGE, hcode: "extreme-positive" })).toEqual({
      status: 503,
      body: { status: false, message: "Read model unavailable" },
    });
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    const facts = await reader.read(CONTEXT, ({ rangeFacts }) =>
      rangeFacts({ date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") }, area: "A" })
    );
    expect(facts.expenseTotals).toEqual([
      { coefficient: `1005${"0".repeat(6172)}1`, scale: 6176 },
      { coefficient: "2675", scale: 3 },
      { coefficient: "12345", scale: 3 },
      { coefficient: "-1005", scale: 3 },
      { coefficient: "4", scale: 3 },
      { coefficient: "4", scale: 3 },
    ]);
    expect(report.inventory.expense.bsonKinds).toMatchObject({ double: 1, decimal: 8, long: 2, int: 25 });
    expect(report.versions.arithmetic).toBe("expense-v1");
    expect(report.components.expenseBar.complete).toBe(true);
    expect(report.validation.expenseBar.equal).toBe(true);
    expect(report.complete).toBe(false);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);
