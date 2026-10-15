import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { sealFixture, rawDocuments, FIXTURE_BUDGET, SECRET } from "./raw-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { startApplication } from "./application.cjs";
import { createRequire } from "node:module";
import path from "node:path";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { Int32, Long, Double, Decimal128, ObjectId, Binary, BSONRegExp } from "mongodb";

let connection;
let cut;
let candidate;
beforeAll(async () => {
  connection = await openFixture();
  cut = sealFixture();
});
afterAll(async () => {
  cut?.close();
  await connection?.close();
});

it("interchanges the pinned native codec with the portable no-run two-container golden vector", () => {
  const require = createRequire(import.meta.url);
  expect(require("roaring/package.json").version).toBe("2.7.0");
  const { RoaringBitmap32 } = require("roaring");
  // Portable-format cookie 12346, two array containers, [0, 1] and [0].
  // https://github.com/RoaringBitmap/RoaringFormatSpec#serialization-format-description
  const golden = Buffer.from("3a300000020000000000010001000000180000001c000000000001000000", "hex");
  const encoded = new RoaringBitmap32([0, 1, 65536]);
  const decoded = RoaringBitmap32.deserialize(golden, "portable");
  try {
    expect(encoded.serialize("portable")).toEqual(golden);
    expect([...decoded]).toEqual([0, 1, 65536]);
  } finally {
    encoded.dispose();
    decoded.dispose();
  }
});

it("builds the full finite raw cut through baseline ETL once and reads exact daily Patients Bar facts", async () => {
  const builder = createBuilder({ db: connection.db });
  candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
  const reader = createReader({ db: connection.db, generationId: candidate.generationId, validationOnly: true });
  const facts = await reader.read(
    {
      route: "patients-bar/live",
      backendMode: "candidate-validation",
      clock: new Date("2024-01-03T00:00:00Z"),
      timeZone: "UTC",
      timeoutMS: 10000,
    },
    ({ rangeFacts }) => rangeFacts({ date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } })
  );
  expect(facts.counts).toEqual([2, 1, 1, 1, 1, 1]);
  expect(facts.services).toEqual([4, 1, 1, 1, 1, 1]);
  expect(facts.matchedRows).toBe(4);
  expect(candidate.components.patientsBar.complete).toBe(true);
  expect(candidate.validation.patientsBar.equal).toBe(true);
  expect(candidate.complete).toBe(false);
  await expect(builder.publish(candidate, null)).rejects.toThrow("incomplete");
}, 60000);

it("keeps a full empty cut valid and rejects unsupported baseline operands and fixed fixture budget overruns", async () => {
  const local = await openFixture();
  const empty = sealFixture([]);
  let app;
  try {
    const builder = createBuilder({ db: local.db });
    const report = await builder.build(empty.sourceCut, FIXTURE_BUDGET, empty.comparisonContext);
    app = await startApplication({ db: local.db, generationId: report.generationId });
    const response = await fetch(`${app.url}/ncds_api/api/v1/bar-chart-pt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-02" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.map(({ qtyOfPatient, avg }) => [qtyOfPatient, avg])).toEqual(
      Array.from({ length: 6 }, () => [0, 0])
    );
    for (const budget of [
      { ...FIXTURE_BUDGET, maxSourceBytes: 1 },
      { ...FIXTURE_BUDGET, maxSerializedBytes: 1 },
      { ...FIXTURE_BUDGET, maxStorageBytes: 1 },
    ]) {
      await expect(builder.build(cut.sourceCut, budget, cut.comparisonContext)).rejects.toThrow();
    }
    const invalidRaw = sealFixture([{ ...rawDocuments()[0], total: 12 }]);
    const invalidSummary = sealFixture([{ date: new Date("2024-01-01"), dm_cid_count: "malformed-array" }], {
      dataset: "summary-fixture",
    });
    try {
      await expect(builder.build(invalidRaw.sourceCut, FIXTURE_BUDGET, invalidRaw.comparisonContext)).rejects.toThrow();
      await expect(
        builder.build(invalidSummary.sourceCut, FIXTURE_BUDGET, invalidSummary.comparisonContext)
      ).rejects.toThrow();
    } finally {
      invalidRaw.close();
      invalidSummary.close();
    }
    await expect(
      createReader({ db: local.db, generationId: report.generationId }).read({}, () => null)
    ).rejects.toThrow("unavailable");
    const snapshot = await fetch(`${app.url}/ncds_api/api/v1/bar-chart-pt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startDate: "2024-01-07",
        endDate: "2024-01-03",
        area: false,
        province: 0,
        district: "",
        hcode: "",
      }),
    });
    expect({ status: snapshot.status, body: await snapshot.json() }).toEqual({
      status: 503,
      body: { status: false, message: "Read model unavailable" },
    });
  } finally {
    await app?.close();
    empty.close();
    await local.close();
  }
}, 60000);

it("rejects missing or changed candidate data as HTTP 503 and can read again after each failed shared operation settles", async () => {
  const local = await openFixture();
  const exported = sealFixture();
  let app;
  try {
    const report = await createBuilder({ db: local.db }).build(
      exported.sourceCut,
      FIXTURE_BUDGET,
      exported.comparisonContext
    );
    app = await startApplication({ db: local.db, generationId: report.generationId });
    const request = async () => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/bar-chart-pt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-02" }),
      });
      return { status: response.status, body: await response.json() };
    };
    expect((await Promise.all(Array.from({ length: 6 }, request))).every(({ status }) => status === 200)).toBe(true);
    const daily = local.db.collection("patients_daily");
    const chunks = local.db.collection("patients_bitmap_chunks");
    const row = await daily.findOne({ generationId: report.generationId });
    const chunk = await chunks.findOne({ generationId: report.generationId }, { promoteLongs: false });
    const faults = [
      { apply: () => daily.deleteOne({ _id: row._id }), restore: () => daily.insertOne(row) },
      { apply: () => chunks.deleteOne({ _id: chunk._id }), restore: () => chunks.insertOne(chunk) },
      {
        apply: () => chunks.updateOne({ _id: chunk._id }, { $set: { payload: new Binary(Buffer.from([0, 1, 2])) } }),
        restore: () => chunks.replaceOne({ _id: chunk._id }, chunk),
      },
      {
        apply: () => chunks.updateOne({ _id: chunk._id }, { $set: { "versions.codec": "unknown" } }),
        restore: () => chunks.replaceOne({ _id: chunk._id }, chunk),
      },
    ];
    for (const fault of faults) {
      await fault.apply();
      try {
        expect(await request()).toEqual({ status: 503, body: { status: false, message: "Read model unavailable" } });
      } finally {
        await fault.restore();
      }
      expect((await request()).status).toBe(200);
    }
    const reader = createReader({ db: local.db, generationId: report.generationId, validationOnly: true });
    const context = {
      route: "patients-bar/live",
      backendMode: "candidate-validation",
      clock: new Date("2024-01-03"),
      timeZone: "UTC",
    };
    const selection = { date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } };
    await expect(
      reader.read({ ...context, timeoutMS: 1 }, ({ rangeFacts }) => rangeFacts(selection))
    ).rejects.toThrow();
    await expect(
      reader.read({ ...context, signal: AbortSignal.abort() }, ({ rangeFacts }) => rangeFacts(selection))
    ).rejects.toThrow();
    expect((await reader.read(context, ({ rangeFacts }) => rangeFacts(selection))).counts).toEqual([2, 1, 1, 1, 1, 1]);
  } finally {
    await app?.close();
    exported.close();
    await local.close();
  }
}, 60000);

it("uses the producer collation for identity classes, independent geography predicates and the lookup index inventory", async () => {
  const local = await openFixture();
  const collation = { locale: "en", strength: 2 };
  const allFields = Object.fromEntries(candidate.bindings.map(({ field }) => [field, []]));
  const rows = [
    {
      ...allFields,
      _id: "case-one",
      date: new Date("2024-01-01"),
      year: 2024,
      month: 1,
      area: "North",
      hcode: "H1",
      dm_cid_count: ["Patient", "PATIENT", 7],
      dm_uid_count: 3,
    },
    {
      ...allFields,
      _id: "case-two",
      date: new Date("2024-01-02"),
      year: 2024,
      month: 1,
      area: "NORTH",
      hcode: "H2",
      dm_cid_count: ["patient", Long.fromString("7"), [7]],
      dm_uid_count: 3,
    },
  ];
  const exported = sealFixture(rows, { dataset: "summary-fixture", collation });
  const baseline = archiveBaseline();
  let legacy, optimized;
  try {
    const report = await createBuilder({ db: local.db }).build(
      exported.sourceCut,
      FIXTURE_BUDGET,
      exported.comparisonContext
    );
    expect(
      report.inventory.indexes.some(
        (index) =>
          index.keys.originalBsonValue === 1 && index.collation?.locale === "en" && index.collation.strength === 2
      )
    ).toBe(true);
    const reader = createReader({ db: local.db, generationId: report.generationId, validationOnly: true });
    const facts = await reader.read(
      {
        route: "patients-bar/live",
        backendMode: "candidate-validation",
        clock: new Date("2024-01-03"),
        timeZone: "UTC",
      },
      ({ rangeFacts }) =>
        rangeFacts({ area: "north", date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } })
    );
    expect(facts.counts).toEqual([3, 0, 0, 0, 0, 0]);
    await local.db.collection("NCD_SUMMARY").drop();
    await local.db.createCollection("NCD_SUMMARY", { collation });
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot });
    optimized = await startApplication({ db: local.db, generationId: report.generationId });
    const body = { startDate: "2024-01-01", endDate: "2024-01-02", area: "north" };
    const results = await Promise.all(
      [legacy, optimized].map(async (server) => {
        const response = await fetch(`${server.url}/ncds_api/api/v1/bar-chart-pt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      })
    );
    expect(results[1]).toEqual(results[0]);
  } finally {
    await legacy?.close();
    await optimized?.close();
    exported.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("rejects moving, incomplete, mislabeled, unsigned and changed source input before a candidate can be read", async () => {
  const builder = createBuilder({ db: connection.db });
  await expect(
    builder.build(
      { collection: "moving", readOnly: true, count: 10, sha256: "same" },
      FIXTURE_BUDGET,
      cut.comparisonContext
    )
  ).rejects.toThrow("producer-sealed");
  const variants = [
    { complete: false },
    { consistency: "count-and-hash-agree" },
    { dataset: "summary" },
    { history: { start: "2024-01-02T00:00:00.000Z", end: "2024-01-02T23:59:59.999Z" } },
    { domain: { revision: "different-cut", records: 10, allSupportedHistory: true } },
  ];
  for (const manifestOverrides of variants) {
    const invalid = sealFixture(rawDocuments(), { manifestOverrides });
    try {
      await expect(builder.build(invalid.sourceCut, FIXTURE_BUDGET, invalid.comparisonContext)).rejects.toThrow();
    } finally {
      invalid.close();
    }
  }
  const untrusted = { ...cut.sourceCut, signature: Buffer.alloc(64) };
  await expect(builder.build(untrusted, FIXTURE_BUDGET, cut.comparisonContext)).rejects.toThrow("Untrusted");
  const changed = sealFixture();
  try {
    fs.chmodSync(changed.sourceCut.filename, 0o600);
    fs.appendFileSync(changed.sourceCut.filename, Buffer.from([0]));
    await expect(builder.build(changed.sourceCut, FIXTURE_BUDGET, changed.comparisonContext)).rejects.toThrow(
      "integrity"
    );
  } finally {
    changed.close();
  }
}, 60000);

it("keeps Mongo BSON identity equivalence, null members, sparse operands and service accumulator meanings", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const allFields = Object.fromEntries(candidate.bindings.map(({ field }) => [field, []]));
  const unusual = [
    new Int32(7),
    Long.fromString("7"),
    new Double(7),
    Decimal128.fromString("7.00"),
    null,
    "7",
    new ObjectId("000000000000000000000007"),
    new Date("2024-01-01"),
    new Binary(Buffer.from([1, 2]), 0),
    new Binary(Buffer.from([1, 2]), 128),
    { a: 1, b: 2 },
    { b: 2, a: 1 },
    [1, 2],
    [7],
    new BSONRegExp("^literal", "i"),
    "$literal",
    true,
    ["x"],
    [],
  ];
  const rows = [
    {
      ...allFields,
      _id: "unusual",
      date: new Date("2024-01-01"),
      year: 1999,
      month: 12,
      area: "A",
      province: "P",
      district: "D",
      hcode: "H",
      dm_cid_count: unusual,
      dm_uid_count: new Int32(4),
      dm_expense: Decimal128.fromString("1.005"),
    },
    {
      _id: "sparse",
      date: new Date("2024-01-02"),
      area: "A",
      hcode: "H",
      dm_cid_count: null,
      ht_cid_count: [null],
      dm_uid_count: [99],
      ht_uid_count: "99",
    },
    {
      ...allFields,
      _id: "scalar-only",
      date: new Date("2024-01-02"),
      area: "A",
      hcode: "H2",
      dm_uid_count: Decimal128.fromString("2.5"),
      dm_expense: new Double(2.675),
    },
  ];
  const exported = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    const report = await createBuilder({ db: local.db }).build(
      exported.sourceCut,
      FIXTURE_BUDGET,
      exported.comparisonContext
    );
    const reader = createReader({ db: local.db, generationId: report.generationId, validationOnly: true });
    const observed = await reader.read(
      {
        route: "patients-bar/live",
        backendMode: "candidate-validation",
        clock: new Date("2024-01-03"),
        timeZone: "UTC",
      },
      async ({ rangeFacts }) => {
        const facts = await rangeFacts({ date: { $gte: new Date("2024-01-01"), $lte: new Date("2024-01-02") } });
        const operands = [];
        for await (const row of facts.expenseOperands) operands.push(row);
        return { counts: facts.counts, operands };
      }
    );
    expect(observed.counts).toEqual([16, 1, 0, 0, 0, 0]);
    expect(observed.operands[0][0]).toEqual({ present: true, value: Decimal128.fromString("1.005") });
    expect(observed.operands[1][0]).toEqual({ present: false });
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot });
    optimized = await startApplication({ db: local.db, generationId: report.generationId });
    for (const selection of [
      {},
      { hcode: "H" },
      { hcode: "H2" },
      { startDate: "2024-01-02" },
      { area: { $in: ["A"] } },
    ]) {
      const body = { startDate: "2024-01-01", endDate: "2024-01-02", ...selection };
      const results = await Promise.all(
        [legacy, optimized].map(async (server) => {
          const response = await fetch(`${server.url}/ncds_api/api/v1/bar-chart-pt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        })
      );
      expect(results[1]).toEqual(results[0]);
    }
  } finally {
    await legacy?.close();
    await optimized?.close();
    exported.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("matches the accepted baseline Patients Bar payload through the existing Express app for typed independent filters", async () => {
  const baseline = archiveBaseline();
  const require = createRequire(import.meta.url);
  const mongoPath = path.join(fs.realpathSync(baseline.sourceRoot), "lib/mongo.js");
  require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { db: connection.db } };
  const { pipeline } = require(path.join(baseline.sourceRoot, "modules/migration/pipeline.js"));
  const raw = connection.db.collection("fixture_baseline_raw");
  await raw.insertMany(rawDocuments());
  for (const day of ["2024-01-01", "2024-01-02"]) {
    const start = new Date(day);
    await raw.aggregate(pipeline(start, new Date(start.getTime() + 86400000 - 1))).toArray();
  }
  const fields = candidate.bindings.map(({ field }) => field);
  for await (const row of connection.db.collection("NCD_SUMMARY").find({})) {
    await connection.db.collection("NCD_SUMMARY").updateOne(
      { _id: row._id },
      {
        $set: Object.fromEntries(
          fields.map((field) => [
            field,
            row[field].map((value) =>
              value ? createHmac("sha256", SECRET).update(value.toString()).digest("hex") : null
            ),
          ])
        ),
      }
    );
  }
  let legacy, optimized;
  try {
    legacy = await startApplication({ db: connection.db, sourceRoot: baseline.sourceRoot });
    optimized = await startApplication({ db: connection.db, generationId: candidate.generationId });
    const cases = [
      {},
      { area: "A" },
      { province: "P" },
      { district: "D2" },
      { hcode: "H2" },
      { area: "A", hcode: "H2" },
      { area: 2 },
      { area: "2" },
      { area: { $in: ["A", 2] } },
      { area: false },
      { area: 0 },
      { area: "" },
      { area: null },
      { area: " " },
      { startDate: "2024-01-01T00:00:00.001Z" },
      { endDate: "2024-01-01T23:59:59.999Z" },
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
    ];
    for (const selection of cases) {
      const body = { startDate: "2024-01-01", endDate: "2024-01-02", ...selection };
      const outputs = await Promise.all(
        [legacy, optimized].map(async (server) => {
          const response = await fetch(`${server.url}/ncds_api/api/v1/bar-chart-pt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        })
      );
      expect(outputs[1], JSON.stringify(selection)).toEqual(outputs[0]);
    }
  } finally {
    await legacy?.close();
    await optimized?.close();
    baseline.close();
    delete require.cache[mongoPath];
  }
}, 60000);
