import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { sealFixture, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { Long, Decimal128, Double, Int32, Binary, ObjectId } from "mongodb";

const RANGE = { startDate: "2024-01-01", endDate: "2024-01-02" };
const FIELDS = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"];
const CONTEXT = {
  route: "card/validation",
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

it("reads the Card and both Bars from one immutable full raw cut while keeping the candidate inactive", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const builder = createBuilder({ db: connection.db });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    expect(await post(app, "card")).toEqual({
      status: 200,
      body: {
        status: true,
        message: "success",
        result: [
          { service_count: 9, patient_count: 6, expense: 370, hcode_count: 2, avg_service: 1.5, avg_expense: 61.67 },
        ],
      },
    });
    expect((await post(app, "bar-chart-pt")).body.result.map(({ qtyOfPatient, avg }) => [qtyOfPatient, avg])).toEqual([
      [2, 2],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    expect((await post(app, "bar-chart-ex")).body.result.map(({ qtyOfExpense, avg }) => [qtyOfExpense, avg])).toEqual([
      [100, 50],
      [10, 10],
      [50, 50],
      [60, 60],
      [70, 70],
      [80, 80],
    ]);
    expect(report.components.card.complete).toBe(true);
    expect(report.components.hospitalDictionary.complete).toBe(true);
    expect(report.complete).toBe(false);
    await expect(builder.publish(report.generationId)).rejects.toThrow(/incomplete/);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("uses baseline hospital set equality for BSON values, scalar-only rows and source collation", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const hospitals = [
    "Hospital",
    "hospital",
    null,
    undefined,
    7,
    new Int32(7),
    Long.fromNumber(7),
    [7],
    { a: 1, b: 2 },
    { b: 2, a: 1 },
    new Binary(Buffer.from([7]), 0),
    new ObjectId("000000000000000000000007"),
  ];
  const rows = hospitals.map((hcode, index) =>
    row(`hospital-${index}`, {
      date: new Date(Date.parse("2024-01-01") + index),
      hcode,
      dm_cid_count: index ? [] : ["one"],
      dm_uid_count: 1,
      dm_expense: 1,
    })
  );
  delete rows[3].hcode;
  const collation = { locale: "en", strength: 2 };
  const cut = sealFixture(rows, { dataset: "summary-fixture", collation });
  let app, legacy;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    await connection.db.collection("NCD_SUMMARY").drop();
    await connection.db.createCollection("NCD_SUMMARY", { collation });
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    expect(await post(app, "card")).toEqual(await post(legacy, "card"));
    expect((await post(app, "card")).body.result).toEqual([
      { service_count: 12, patient_count: 1, expense: 12, hcode_count: 8, avg_service: 12, avg_expense: 12 },
    ]);
    expect(report.validation.card.hospitalCount).toBe(8);
  } finally {
    await app?.close();
    await legacy?.close();
    baseline.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps empty input distinct from matched empty patients and rejects changed Card facts or incompatible components", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  const empty = sealFixture([]);
  let app, emptyApp;
  try {
    const builder = createBuilder({ db: connection.db });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const daily = connection.db.collection("patients_daily");
    const original = await daily.findOne(
      { generationId: report.generationId },
      { promoteValues: false, promoteLongs: false }
    );
    for (const changes of [
      { "card.service": 999 },
      { "card.version": "unknown" },
      { "card.patientState": "null" },
      { "members.CARD.chunks": 0 },
      { "members.HOSPITAL.cardinality": 0 },
    ]) {
      await daily.updateOne({ _id: original._id }, { $set: changes });
      try {
        expect(await post(app, "card")).toEqual({
          status: 503,
          body: { status: false, message: "Read model unavailable" },
        });
      } finally {
        await daily.replaceOne({ _id: original._id }, original);
      }
      expect((await post(app, "card")).status).toBe(200);
    }
    const generations = connection.db.collection("patients_generations");
    const generation = await generations.findOne({ _id: report.generationId });
    for (const changes of [
      { "components.card.complete": false },
      { "components.hospitalDictionary.generationId": "wrong" },
      { "versions.card": "wrong" },
    ]) {
      await generations.updateOne({ _id: report.generationId }, { $set: changes });
      try {
        expect(await post(app, "card")).toEqual({
          status: 503,
          body: { status: false, message: "Read model unavailable" },
        });
      } finally {
        await generations.replaceOne({ _id: report.generationId }, generation);
      }
    }
    const emptyReport = await builder.build(empty.sourceCut, FIXTURE_BUDGET, empty.comparisonContext);
    emptyApp = await startApplication({ db: connection.db, generationId: emptyReport.generationId });
    expect(await post(emptyApp, "card")).toEqual({
      status: 200,
      body: {
        status: true,
        message: "success",
        result: [{ service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 }],
      },
    });
    expect(
      await post(emptyApp, "card", {
        startDate: "2024-01-07",
        endDate: "2024-01-03",
        area: false,
        province: 0,
        district: "",
        hcode: "",
      })
    ).toEqual({ status: 503, body: { status: false, message: "Read model unavailable" } });
  } finally {
    await app?.close();
    await emptyApp?.close();
    cut.close();
    empty.close();
    await connection.close();
  }
}, 60000);

it("shares equivalent daily ranges without sharing a different caller's freshness or cancellation state", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    const selection = { date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } };
    const [fresh, stale] = await Promise.all([
      reader.read({ ...CONTEXT, route: "card/live", rangeRoute: "daily-range/live" }, ({ rangeFacts }) =>
        rangeFacts(selection)
      ),
      reader.read(
        { ...CONTEXT, route: "expense-bar/live", rangeRoute: "daily-range/live", clock: new Date("2024-01-05") },
        ({ rangeFacts }) => rangeFacts(selection)
      ),
    ]);
    expect([fresh.source.state, stale.source.state]).toEqual(["fresh", "stale"]);
    const controller = new AbortController();
    controller.abort();
    const outcomes = await Promise.allSettled([
      reader.read({ ...CONTEXT, rangeRoute: "daily-range/live", signal: controller.signal }, ({ rangeFacts }) =>
        rangeFacts(selection)
      ),
      reader.read({ ...CONTEXT, route: "patients-bar/live", rangeRoute: "daily-range/live" }, ({ rangeFacts }) =>
        rangeFacts(selection)
      ),
    ]);
    expect(outcomes[0].status).toBe("rejected");
    expect(outcomes[1].status).toBe("fulfilled");
    expect(outcomes[1].value.cardPatientCount).toBe(6);
  } finally {
    cut.close();
    await connection.close();
  }
}, 60000);

it("preserves baseline Card BSON service arithmetic and data errors without disabling the independent Bars", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const operands = [
    null,
    undefined,
    "7",
    [7],
    { value: 7 },
    true,
    new Int32(7),
    Long.fromString("9007199254740993"),
    Decimal128.fromString("1.005"),
    new Double(-1.005),
    new Double(NaN),
    new Double(Infinity),
    new Date("2024-01-01"),
  ];
  const rows = operands.map((dm_uid_count, index) => row(`service-${index}`, { dm_cid_count: ["one"], dm_uid_count }));
  delete rows[1].dm_uid_count;
  rows.push(
    row("two-dates", {
      dm_cid_count: ["one"],
      dm_uid_count: new Date("2024-01-01"),
      ht_uid_count: new Date("2024-01-01"),
    })
  );
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let app, legacy;
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    for (const { hcode } of rows) {
      const body = { ...RANGE, hcode };
      expect(await post(app, "card", body), hcode).toEqual(await post(legacy, "card", body));
      expect(await post(app, "bar-chart-pt", body), hcode).toEqual(await post(legacy, "bar-chart-pt", body));
    }
    expect(report.validation.card).toMatchObject({ equal: true, baselineError: true });
  } finally {
    await app?.close();
    await legacy?.close();
    baseline.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("rounds the Card from the six exact unrounded totals and its union denominator once", async () => {
  const connection = await openFixture();
  try {
    /** @type {Array<[string[], { expense: number, avg_expense: number }, number[]]>} */
    const examples = [
      [["0.004", "0.004", "0", "0", "0", "0"], { expense: 0.01, avg_expense: 0 }, [0, 0, 0, 0, 0, 0]],
      [
        ["1.005", "2.675", "12.345", "-1.005", "0.004", "0.004"],
        { expense: 15.03, avg_expense: 7.51 },
        [1.01, 2.68, 12.35, -1.01, 0, 0],
      ],
      [["-0.004", "-0.006", "0", "0", "0", "0"], { expense: -0.01, avg_expense: -0.01 }, [0, -0.01, 0, 0, 0, 0]],
    ];
    for (const [operands, expected, barAmounts] of examples) {
      const cut = sealFixture(
        [
          row("rounding", {
            dm_cid_count: ["one", "two"],
            ...Object.fromEntries(
              FIELDS.map((field, index) => [`${field}_expense`, Decimal128.fromString(operands[index])])
            ),
          }),
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
        expect((await post(app, "card")).body.result).toEqual([
          { service_count: 0, patient_count: 2, hcode_count: 1, avg_service: 0, ...expected },
        ]);
        expect((await post(app, "bar-chart-ex")).body.result.map(({ qtyOfExpense }) => qtyOfExpense)).toEqual(
          barAmounts
        );
      } finally {
        await app?.close();
        cut.close();
      }
    }
    const unsafe = sealFixture(
      [
        row("card-unsafe", {
          dm_cid_count: ["one"],
          ht_cid_count: ["one"],
          dm_expense: Decimal128.fromString("45035996273704.96"),
          ht_expense: Decimal128.fromString("45035996273704.97"),
        }),
      ],
      { dataset: "summary-fixture" }
    );
    try {
      await expect(
        createBuilder({ db: connection.db }).build(unsafe.sourceCut, FIXTURE_BUDGET, unsafe.comparisonContext)
      ).rejects.toThrow(/serialization/);
    } finally {
      unsafe.close();
    }
  } finally {
    await connection.close();
  }
}, 60000);

it("keeps row-level Card presence, separate service addition and typed hospital equality through exact baseline HTTP selections", async () => {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    row("H1", {
      dm_cid_count: ["one", "one"],
      ht_cid_count: ["one", "two"],
      dm_uid_count: 2,
      ht_uid_count: 3,
      dm_expense: 10,
      ht_expense: 20,
    }),
    row("H2", {
      date: new Date("2024-01-02T12:00:00Z"),
      area: 2,
      province: "P2",
      district: "D2",
      dm_cid_count: ["one"],
      dm_uid_count: 4,
      dm_expense: 10,
    }),
    row("H3", {
      dm_cid_count: ["suppressed-null"],
      ht_cid_count: null,
      dm_uid_count: 7,
      ht_uid_count: null,
      dm_expense: 7,
    }),
    row("H4", { dm_cid_count: ["suppressed-missing"], dm_uid_count: 5, dm_expense: 5 }),
    row("null-hospital", { hcode: null, dm_uid_count: 11, dm_expense: 7 }),
    row("missing-hospital", { date: new Date("2024-01-01T01:00:00Z"), dm_uid_count: 13, dm_expense: 13 }),
    row("numeric-hospital", { hcode: 2, dm_cid_count: ["one"], dm_uid_count: 1 }),
    row("long-hospital", {
      date: new Date("2024-01-01T00:00:00.001Z"),
      hcode: Long.fromNumber(2),
      dm_cid_count: ["one"],
      dm_uid_count: 1,
    }),
  ];
  delete rows[3].psy_cid_count;
  delete rows[3].ht_uid_count;
  delete rows[5].hcode;
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let app, legacy;
  const range = { ...RANGE, endDate: "2024-01-02T12:00:00Z" };
  try {
    const report = await createBuilder({ db: connection.db }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    await connection.db.collection("NCD_SUMMARY").insertMany(rows);
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    const observed = await post(app, "card", range);
    expect(observed).toEqual({
      status: 200,
      body: {
        status: true,
        message: "success",
        result: [
          { service_count: 35, patient_count: 2, expense: 72, hcode_count: 6, avg_service: 17.5, avg_expense: 36 },
        ],
      },
    });
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    const facts = await reader.read(CONTEXT, ({ rangeFacts }) =>
      rangeFacts({ date: { $gte: new Date(range.startDate), $lte: new Date(range.endDate) } })
    );
    expect(facts.counts).toEqual([3, 2, 0, 0, 0, 0]);
    expect([facts.cardPatientCount, facts.hospitalCount, facts.cardService]).toEqual([2, 6, 35]);
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
      { hcode: "H3" },
      { hcode: "H4" },
      { hcode: { $type: "null" } },
      { hcode: { $exists: false } },
      { hcode: 2 },
    ]) {
      const body = { ...range, ...selection };
      expect(await post(app, "card", body), JSON.stringify(selection)).toEqual(await post(legacy, "card", body));
    }
    expect(report.validation.card).toMatchObject({
      equal: true,
      scope: "full-supported-history",
      patientCount: 2,
      hospitalCount: 6,
    });
  } finally {
    await app?.close();
    await legacy?.close();
    baseline.close();
    cut.close();
    await connection.close();
  }
}, 60000);
