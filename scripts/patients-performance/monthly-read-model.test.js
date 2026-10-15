import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { sealFixture, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { startApplication } from "./application.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { Decimal128, Int32, Long, Double, Binary } from "mongodb";

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
const empty = Object.fromEntries(fields.map((field) => [`${field}_cid_count`, []]));
const routes = ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const clock = "2026-10-15T00:00:00.000Z";
const context = {
  route: "patients-graphs/live",
  backendMode: "candidate-validation",
  clock: new Date(clock),
  timeZone: "UTC",
  timeoutMS: 10000,
};
const periods = Array.from({ length: 12 }, (_, i) => ({ year: i < 2 ? 2025 : 2026, month: ((i + 10) % 12) + 1 }));

async function graphs(server, body = {}) {
  return Promise.all(
    routes.map(async (route) => {
      const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
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

it("reads the three existing graph payloads from one ordered stored-period matrix with historical geography and overlapping categories", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    {
      ...empty,
      _id: "first",
      date: new Date("2024-01-01"),
      year: 2026,
      month: 10,
      area: "A",
      province: "P",
      district: "D1",
      hcode: "H1",
      dm_cid_count: ["shared", "shared", "dm"],
      ht_cid_count: ["shared"],
      ca_cid_count: ["shared"],
      hg_cid_count: ["shared"],
      dm_ckd_cid_count: ["shared"],
      lung_ca_cid_count: ["shared"],
      breast_ca_cid_count: ["shared"],
    },
    {
      ...empty,
      _id: "move",
      date: new Date("2024-01-02"),
      year: 2026,
      month: 9,
      area: "B",
      province: "P",
      district: "D2",
      hcode: "H1",
      dm_cid_count: ["shared"],
      ca_cid_count: ["other"],
    },
    {
      ...empty,
      _id: "typed",
      date: new Date("2024-01-02"),
      year: "2026",
      month: "10",
      area: "A",
      province: "P",
      district: "D1",
      hcode: "H2",
      dm_cid_count: ["excluded"],
    },
  ];
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const builder = createBuilder({ db: local.db });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    const reader = createReader({ db: local.db, generationId: candidate.generationId, validationOnly: true });
    const facts = await reader.read(context, ({ monthFacts }) => monthFacts({}, periods));
    expect(facts.counts).toHaveLength(12);
    expect(facts.source).toMatchObject({ sourceCutAt: "2024-01-03T00:00:00.000Z", state: "unknown" });
    expect(facts.counts.every((row) => row.length === 15)).toBe(true);
    expect(facts.counts[11]).toEqual([2, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
    expect(candidate.components.monthlyStored.complete).toBe(true);
    expect(candidate.validation.monthlyStored).toMatchObject({ equal: true, categories: 15 });
    expect(candidate.complete).toBe(false);
    await expect(builder.publish(candidate, null)).rejects.toThrow("incomplete");
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    for (const body of [
      {},
      { hcode: "H1" },
      { area: "A", province: "P" },
      { area: "A", district: "D2" },
      { area: "B" },
      { area: { $in: ["A", "B"] } },
      { area: false, startDate: "invalid", endDate: "1900-01-01", year: 1900 },
    ]) {
      const reference = await graphs(legacy, body);
      expect(await graphs(legacy, body)).toEqual(reference);
      expect(await graphs(optimized, body), JSON.stringify(body)).toEqual(reference);
    }
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("preserves BSON stored periods, sparse operands and typed independent geography rather than date-derived graph months", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  /** @type {Array<[unknown, unknown, string, string | number]>} */
  const definitions = [
    [new Int32(2026), new Int32(10), "int32", "A"],
    [Long.fromInt(2026), Long.fromInt(9), "long", "A"],
    [new Double(2026), new Double(8), "double", "A"],
    [Decimal128.fromString("2026"), new Int32(7), "decimal-year", "A"],
    [new Int32(2026), Decimal128.fromString("6"), "decimal-month", "A"],
    ["2026", "5", "string", "A"],
    [[2026], 4, "array", "A"],
    [null, 3, "null", "A"],
    [undefined, undefined, "missing", "A"],
    [2026, 3, "typed-geography", 7],
    [2026, 2, "other-geography", "7"],
  ];
  const rows = definitions.map(([year, month, kind, area], index) => ({
    ...empty,
    _id: kind,
    date: new Date(`2024-01-01T00:00:00.${String(index).padStart(3, "0")}Z`),
    ...(year === undefined ? {} : { year }),
    ...(month === undefined ? {} : { month }),
    area,
    province: "Independent",
    district: "D",
    hcode: `H-${kind}`,
    dm_cid_count: ["repeat", "repeat", null, []],
    ca_cid_count: [null],
    hg_cid_count: index % 2 === 0 ? [null] : null,
    dm_ckd_cid_count: undefined,
    lung_ca_cid_count: [null],
    breast_ca_cid_count: [null],
  }));
  delete rows[0].dm_ckd_cid_count;
  rows.push({
    ...empty,
    _id: "missing-geography",
    date: new Date("2024-01-02"),
    year: 2026,
    month: 1,
    dm_cid_count: ["missing-geography"],
  });
  rows.push({
    ...empty,
    _id: "array-geography",
    date: new Date("2024-01-02T00:00:00.001Z"),
    year: 2026,
    month: 1,
    hcode: null,
    area: ["A", "C"],
    dm_cid_count: ["array-geography"],
  });
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    for (const body of [
      {},
      ...definitions.map(([, , kind]) => ({ hcode: `H-${kind}` })),
      { area: 7 },
      { area: "7" },
      { province: "Independent" },
      { district: "D", province: "wrong" },
      { hcode: { $in: ["H-int32", "H-long"] } },
      { hcode: { $exists: false } },
      { area: { $all: ["A", "C"] } },
      { area: { $ne: "7" } },
      { area: ["A"] },
      { area: null },
      { area: 0 },
    ]) {
      const reference = await graphs(legacy, body);
      expect(await graphs(legacy, body)).toEqual(reference);
      expect(await graphs(optimized, body), JSON.stringify(body)).toEqual(reference);
    }
    const reference = await graphs(legacy);
    expect(reference[0].body.result[1].data).toEqual([0, 0, 2, 3, 3, 0, 0, 0, 0, 3, 3, 3]);
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("keeps local clock windows and graph snapshot routing independent of request dates and falsy geography", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const rows = Array.from({ length: 24 }, (_, index) => ({
    ...empty,
    _id: `month-${index}`,
    date: new Date("2024-01-01"),
    year: 2025 + Math.floor(index / 12),
    month: (index % 12) + 1,
    area: "A",
    hcode: `H${index}`,
    ...Object.fromEntries(
      fields.map((field) => [`${field}_cid_count`, Array.from({ length: (index % 4) + 1 }, (_, i) => `p${i}`)])
    ),
  }));
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    for (const [clock, timeZone] of [
      ["2026-10-31T16:59:59.999Z", "Asia/Bangkok"],
      ["2026-10-31T17:00:00.000Z", "Asia/Bangkok"],
      ["2026-10-31T17:00:00.000Z", "UTC"],
      ["2025-12-31T17:00:00.000Z", "Asia/Bangkok"],
      ["2026-02-28T17:00:00.000Z", "Asia/Bangkok"],
    ]) {
      const legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock, timeZone });
      const optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock, timeZone });
      try {
        const reference = await graphs(legacy);
        expect(await graphs(legacy)).toEqual(reference);
        for (const body of [
          {},
          { startDate: "wrong", endDate: "wrong", year: 1900, area: null },
          { area: false, province: 0, district: null, hcode: "" },
          { area: { $eq: "A" } },
        ])
          expect(await graphs(optimized, body), `${clock}/${timeZone}`).toEqual(reference);
        const snapshots = await graphs(optimized, { area: "", province: "", district: "", hcode: "" });
        expect(snapshots.map(({ status, body }) => ({ status, body }))).toEqual(
          routes.map(() => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
        );
      } finally {
        await legacy.close();
        await optimized.close();
      }
    }
  } finally {
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("fails changed monthly inventories and chunks as 503, removes settled work, and isolates one caller's cancellation", async () => {
  const local = await openFixture();
  const cut = sealFixture(
    [
      {
        ...empty,
        _id: "one",
        date: new Date("2024-01-01"),
        year: 2026,
        month: 10,
        area: "A",
        hcode: "H",
        dm_cid_count: ["p"],
        hg_cid_count: ["p"],
        ca_cid_count: ["p"],
        lung_ca_cid_count: ["p"],
      },
    ],
    { dataset: "summary-fixture" }
  );
  let app;
  try {
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    const reader = createReader({ db: local.db, generationId: candidate.generationId, validationOnly: true });
    const attempt = (extra = {}) =>
      reader.read({ ...context, ...extra }, ({ monthFacts }) => monthFacts({ area: "A", hcode: "H" }, periods));
    const settled = await Promise.allSettled([
      attempt(),
      attempt({ signal: AbortSignal.abort() }),
      attempt(),
      attempt(),
    ]);
    expect(settled.map(({ status }) => status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    expect(settled[0].value.counts[11][0]).toBe(1);
    await expect(attempt({ timeoutMS: 1 })).rejects.toThrow();
    const atoms = local.db.collection("patients_month_atoms"),
      chunks = local.db.collection("patients_bitmap_chunks");
    const atom = await atoms.findOne({ generationId: candidate.generationId }, { promoteLongs: false });
    const chunk = await chunks.findOne(
      { generationId: candidate.generationId, setId: atom.rowId },
      { promoteLongs: false }
    );
    const faults = [
      { apply: () => atoms.deleteOne({ _id: atom._id }), restore: () => atoms.insertOne(atom) },
      {
        apply: () => atoms.updateOne({ _id: atom._id }, { $unset: { "members.DM": "" } }),
        restore: () => atoms.replaceOne({ _id: atom._id }, atom),
      },
      { apply: () => chunks.deleteOne({ _id: chunk._id }), restore: () => chunks.insertOne(chunk) },
      {
        apply: () => chunks.updateOne({ _id: chunk._id }, { $set: { payload: new Binary(Buffer.from([0, 1, 2])) } }),
        restore: () => chunks.replaceOne({ _id: chunk._id }, chunk),
      },
      {
        apply: () => chunks.updateOne({ _id: chunk._id }, { $set: { "versions.codec": "changed" } }),
        restore: () => chunks.replaceOne({ _id: chunk._id }, chunk),
      },
    ];
    for (const fault of faults) {
      await fault.apply();
      try {
        await expect(attempt()).rejects.toThrow();
        expect((await graphs(app, { area: "A", hcode: "H" })).map(({ status, body }) => ({ status, body }))).toEqual(
          routes.map(() => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
        );
      } finally {
        await fault.restore();
      }
      expect((await attempt()).counts[11][0]).toBe(1);
      expect((await graphs(app)).every(({ status }) => status === 200)).toBe(true);
    }
    expect((await graphs(app, { area: { $unsupported: 1 } })).every(({ status }) => status === 503)).toBe(true);
    await expect(
      reader.read({ ...context, route: "patients-graphs/snapshot/disease" }, ({ snapshot }) =>
        snapshot("disease-patients")
      )
    ).rejects.toThrow("incomplete");
  } finally {
    await app?.close();
    cut.close();
    await local.close();
  }
}, 60000);

it("keeps direct graph unwind semantics for scalar subtype operands without changing Bar membership validation", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const rows = [0, 1].map((index) => ({
    ...empty,
    _id: `scalar-subtypes-${index}`,
    date: new Date(`2024-01-0${index + 1}`),
    year: 2026,
    month: 10,
    area: "A",
    hcode: "H",
    dm_cid_count: ["p"],
    ca_cid_count: ["p"],
    hg_cid_count: "$patient",
    dm_ckd_cid_count: false,
    dm_acs_cid_count: 0,
    dm_cva_cid_count: { a: 1, b: 2 },
    lung_ca_cid_count: index === 0 ? Long.fromInt(7) : Decimal128.fromString("7.00"),
    breast_ca_cid_count: new Binary(Buffer.from([1, 2])),
    cervical_ca_cid_count: new Date("2024-01-01"),
    liver_ca_cid_count: "patient",
    colorectal_ca_cid_count: [null],
  }));
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    const reference = await graphs(legacy);
    expect(await graphs(legacy)).toEqual(reference);
    expect(await graphs(optimized)).toEqual(reference);
    expect(reference[1].body.result.map(({ data }) => data[11])).toEqual([1, 1, 1, 1, 0]);
    expect(reference[2].body.result.map(({ data }) => data[11])).toEqual([1, 1, 1, 1, 1, 0]);
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("accepts stable mixed BSON periods when their present memberships belong to separate categories", async () => {
  const local = await openFixture();
  const baseline = archiveBaseline();
  const rows = [
    {
      ...empty,
      _id: "number",
      date: new Date("2024-01-01"),
      year: new Int32(2026),
      month: 10,
      hcode: "H1",
      dm_cid_count: ["p"],
    },
    {
      ...empty,
      _id: "decimal",
      date: new Date("2024-01-02"),
      year: Decimal128.fromString("2026"),
      month: 10,
      hcode: "H2",
      ht_cid_count: ["p"],
    },
    {
      ...empty,
      _id: "empty-decimal",
      date: new Date("2024-01-02"),
      year: Decimal128.fromString("2026"),
      month: 10,
      hcode: "H3",
    },
    {
      ...empty,
      _id: "outside-window-number",
      date: new Date("2024-01-02"),
      year: new Int32(2026),
      month: 13,
      hcode: "H4",
      dm_cid_count: ["p"],
    },
    {
      ...empty,
      _id: "outside-window-decimal",
      date: new Date("2024-01-02"),
      year: Decimal128.fromString("2026"),
      month: 13,
      hcode: "H5",
      dm_cid_count: ["p"],
    },
  ];
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  let legacy, optimized;
  try {
    await local.db.collection("NCD_SUMMARY").insertMany(rows);
    const candidate = await createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    legacy = await startApplication({ db: local.db, sourceRoot: baseline.sourceRoot, clock });
    optimized = await startApplication({ db: local.db, generationId: candidate.generationId, clock });
    const reference = await graphs(legacy);
    expect(await graphs(legacy)).toEqual(reference);
    expect(await graphs(optimized)).toEqual(reference);
    expect(reference[0].body.result[1].data[11]).toBe(1);
    expect(reference[0].body.result[2].data[11]).toBe(0);
  } finally {
    await legacy?.close();
    await optimized?.close();
    cut.close();
    baseline.close();
    await local.close();
  }
}, 60000);

it("rejects unstable mixed numeric period presentation rather than normalizing the baseline", async () => {
  const local = await openFixture();
  const rows = [new Int32(2026), Decimal128.fromString("2026")].map((year, index) => ({
    ...empty,
    _id: `mixed-${index}`,
    date: new Date(`2024-01-0${index + 1}`),
    year,
    month: 10,
    hcode: `H${index}`,
    dm_cid_count: [`p${index}`],
  }));
  const cut = sealFixture(rows, { dataset: "summary-fixture" });
  try {
    await expect(
      createBuilder({ db: local.db }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext)
    ).rejects.toThrow("Unstable baseline BSON stored-period presentation");
  } finally {
    cut.close();
    await local.close();
  }
}, 60000);
