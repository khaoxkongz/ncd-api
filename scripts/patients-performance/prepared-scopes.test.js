import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { sealFixture, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { startApplication } from "./application.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { Decimal128, Int32, Long, Double } from "mongodb";

const fields = [
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
const clock = "2026-10-15T00:00:00.000Z";
const context = {
  route: "patients-graphs/live",
  backendMode: "candidate-validation",
  clock: new Date(clock),
  timeZone: "UTC",
  timeoutMS: 10000,
};
const periods = Array.from({ length: 12 }, (_, i) => ({ year: i < 2 ? 2025 : 2026, month: ((i + 10) % 12) + 1 }));

async function graphs(app, body) {
  return Promise.all(
    ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"].map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") },
        body: await response.json(),
      };
    })
  );
}

it("prepares all fifteen stored graph sets for exact national and observed independent scopes without assuming a geography hierarchy", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    {
      _id: "first",
      date: new Date("2024-01-01"),
      year: 2026,
      month: 10,
      area: "A",
      province: "P",
      district: "D1",
      hcode: "H1",
      ...Object.fromEntries(fields.map((field) => [`${field}_cid_count`, ["shared", "a", "a"]])),
    },
    {
      _id: "second",
      date: new Date("2024-01-02"),
      year: 2026,
      month: 10,
      area: "B",
      province: "P",
      district: "D2",
      hcode: "H2",
      ...Object.fromEntries(fields.map((field) => [`${field}_cid_count`, ["shared", "b"]])),
    },
    {
      _id: "move",
      date: new Date("2024-01-02"),
      year: 2026,
      month: 9,
      area: "C",
      province: "Q",
      district: "D3",
      hcode: "H1",
      ...Object.fromEntries(fields.map((field) => [`${field}_cid_count`, ["shared", "c"]])),
    },
  ];
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const builder = createBuilder({ db: local.db });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    expect(candidate.components.preparedStored).toMatchObject({ generationId: candidate.generationId, complete: true });
    expect(candidate.validation.preparedStored).toMatchObject({
      equal: true,
      setsEqual: true,
      categories: 15,
      scope: "all-observed-single-field-equalities-and-national",
    });
    const reader = createReader({ db: local.db, generationId: candidate.generationId, validationOnly: true });
    const national = await reader.read(context, ({ monthFacts }) => monthFacts({}, periods));
    const province = await reader.read(context, ({ monthFacts }) => monthFacts({ province: "P" }, periods));
    expect(national.counts[11]).toEqual(Array(15).fill(3));
    expect(national.counts[10]).toEqual(Array(15).fill(2));
    expect(province.counts[11]).toEqual(Array(15).fill(3));
    expect(province.counts[10]).toEqual(Array(15).fill(0));
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    for (const [prepared, atom] of [
      [{}, { province: { $nin: ["absent"] } }],
      [{ province: "P" }, { province: { $eq: "P" } }],
      [{ hcode: "H1" }, { hcode: { $eq: "H1" } }],
    ]) {
      const reference = await graphs(legacy, prepared);
      expect(await graphs(legacy, prepared)).toEqual(reference);
      expect(await graphs(optimized, prepared)).toEqual(reference);
      expect(await graphs(optimized, atom)).toEqual(reference);
    }
    expect(candidate.complete).toBe(false);
    await expect(builder.publish(candidate, null)).rejects.toThrow("incomplete");
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("fails damaged selected prepared facts without silently taking the atom path and keeps complete residual selections exact", async () => {
  const local = await openFixture();
  const rows = ["A", "B"].map((area, i) => ({
    _id: `fault-${i}`,
    date: new Date(`2024-01-0${i + 1}`),
    year: 2026,
    month: 10,
    area,
    province: "P",
    hcode: `H${i}`,
    ...Object.fromEntries(fields.map((field) => [`${field}_cid_count`, ["shared", `p${i}`]])),
  }));
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let app;
  try {
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    const reader = createReader({ db: local.db, generationId: candidate.generationId, validationOnly: true });
    const read = (scope) => reader.read(context, ({ monthFacts }) => monthFacts(scope, periods));
    const catalog = local.db.collection("patients_scopes"),
      prepared = local.db.collection("patients_month_scopes");
    const scope = await catalog.findOne({ generationId: candidate.generationId, scopeKind: "area", value: "A" });
    const month = await prepared.findOne({ generationId: candidate.generationId, scopeId: scope.scopeId });
    app = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    const faults = [
      { apply: () => catalog.deleteOne({ _id: scope._id }), restore: () => catalog.insertOne(scope) },
      { apply: () => prepared.deleteOne({ _id: month._id }), restore: () => prepared.insertOne(month) },
      {
        apply: () => prepared.updateOne({ _id: month._id }, { $set: { "members.DM.cardinality": 0 } }),
        restore: () => prepared.replaceOne({ _id: month._id }, month),
      },
      {
        apply: () => catalog.updateOne({ _id: scope._id }, { $set: { sha256: "changed" } }),
        restore: () => catalog.replaceOne({ _id: scope._id }, scope),
      },
    ];
    for (const fault of faults) {
      await fault.apply();
      try {
        await expect(read({ area: "A" })).rejects.toThrow();
        expect((await graphs(app, { area: "A" })).map(({ status, body }) => ({ status, body }))).toEqual(
          Array.from({ length: 3 }, () => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
        );
        expect((await read({ area: { $eq: "A" } })).counts[11]).toEqual(Array(15).fill(2));
        expect((await read({ area: "A", province: "P" })).counts[11]).toEqual(Array(15).fill(2));
        expect((await read({ area: "A", hcode: "H1" })).counts[11]).toEqual(Array(15).fill(0));
      } finally {
        await fault.restore();
      }
      expect((await read({ area: "A" })).counts[11]).toEqual(Array(15).fill(2));
    }
  } finally {
    await app?.close();
    cut.close();
    await local.close();
  }
}, 60000);

it("matches prepared and atom graph payloads under source collation, stable BSON periods, typed equality and residual predicates", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const collation = { locale: "en", strength: 2 };
  const definitions = [
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
  ];
  const rows = definitions.map(([year, month, area, province, hcode, members], i) => ({
    _id: `typed-${i}`,
    date: new Date(`2024-01-01T00:00:00.${String(i).padStart(3, "0")}Z`),
    year,
    month,
    ...(area === undefined ? {} : { area }),
    ...(province === undefined ? {} : { province }),
    hcode,
    district: "D",
    ...Object.fromEntries(fields.map((field) => [`${field}_cid_count`, members])),
  }));
  const cut = sealFixture(rows, { dataset: "summary-fixture", collation });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").drop();
    await local.db.createCollection("NCD_SUMMARY", { collation });
    await local.db.collection("NCD_SUMMARY").createIndex({ date: 1 });
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    for (const collection of ["patients_bitmap_chunks", "patients_bitmap_directory"])
      expect(
        candidate.inventory.indexes.some(
          (index) => index.collection === collection && index.keys.setId === 1 && index.collation?.locale === "en"
        )
      ).toBe(true);
    const reader = createReader({ db: local.db, generationId: candidate.generationId, validationOnly: true });
    expect((await reader.read(context, ({ monthFacts }) => monthFacts({}, periods))).counts[11]).toEqual(
      Array(15).fill(8)
    );
    expect((await reader.read(context, ({ monthFacts }) => monthFacts({ area: "A" }, periods))).counts[11]).toEqual(
      Array(15).fill(4)
    );
    expect(
      (await reader.read(context, ({ monthFacts }) => monthFacts({ area: new Double(7) }, periods))).counts[11]
    ).toEqual(Array(15).fill(3));
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    for (const [prepared, atom] of [
      [{}, { area: { $nin: ["absent"] } }],
      [{ area: "A" }, { area: { $eq: "A" } }],
      [{ area: "a" }, { area: { $eq: "a" } }],
      [{ province: "P" }, { province: { $eq: "P" } }],
      [{ area: 7 }, { area: { $eq: 7 } }],
      [{ area: "7" }, { area: { $eq: "7" } }],
      [{ area: ["A", "C"] }, { area: { $eq: ["A", "C"] } }],
      [{ area: { left: 1, right: 2 } }, { area: { $eq: { left: 1, right: 2 } } }],
    ]) {
      const reference = await graphs(legacy, prepared);
      expect(await graphs(legacy, prepared)).toEqual(reference);
      expect(await graphs(optimized, prepared)).toEqual(reference);
      expect(await graphs(optimized, atom)).toEqual(reference);
    }
    for (const body of [
      { area: "A", province: "P" },
      { area: "A", province: "Else", hcode: "H6" },
      { area: "A", hcode: "H3" },
      { area: "unobserved" },
      { area: { $all: ["A", "C"] }, district: "D" },
    ]) {
      const reference = await graphs(legacy, body);
      expect(await graphs(legacy, body)).toEqual(reference);
      expect(await graphs(optimized, body)).toEqual(reference);
    }
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);
