import { expect, it } from "vite-plus/test";
import { openFixture } from "./contract.cjs";
import { sealFixture, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { startApplication } from "./application.cjs";
import { BSON, Decimal128 } from "mongodb";
import { createHash } from "node:crypto";

const CLOCK = new Date("2024-01-03T00:00:00.000Z");
const SNAPSHOT = { startDate: "2024-01-07", endDate: "2024-01-03", area: "", province: "", district: "", hcode: "" };
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const VIEWS = ["card", "patients-bar", "expense-bar", "disease-patients", "dm-patients", "ca-patients"];
const CONTEXT = { backendMode: "candidate-validation", clock: CLOCK, timeZone: "UTC" };
const FIELDS = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"];

function summary(overrides = {}) {
  return {
    _id: "snapshot-facts",
    date: new Date("2024-01-08"),
    year: 2024,
    month: 1,
    hcode: "H",
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

// Input fixture preparation, not an alternate Reader: retained snapshot inputs
// carry their own BSON inventory seal just as newly built immutable views do.
function storedFixture(document, changes) {
  const fixture = BSON.deserialize(BSON.serialize(document));
  changes(fixture);
  const { _id, sha256: _sha256, ...content } = fixture;
  fixture.sha256 = createHash("sha256").update(BSON.serialize(content)).digest("hex");
  return fixture;
}

async function post(app, route, body = SNAPSHOT, headers = {}) {
  const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://fixture.invalid", ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    sourceCut: response.headers.get("x-ncd-source-cut"),
    state: response.headers.get("x-ncd-data-state"),
    cache: response.headers.get("cache-control"),
    exposed: response.headers.get("access-control-expose-headers"),
    etag: response.headers.get("etag"),
  };
}

it("builds all six compatible stored views from one immutable raw cut and returns their effective provenance", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const builder = createBuilder({ db: connection.db, clock: () => CLOCK, timeZone: "UTC" });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({
      db: connection.db,
      generationId: report.generationId,
      responseHeaders: { "Access-Control-Expose-Headers": "X-Existing, x-ncd-data-state" },
    });
    const responses = await Promise.all(ROUTES.map((route) => post(app, route)));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: true, message: "success", result: expect.any(Array) });
      expect(response.sourceCut).toBe(CLOCK.toISOString());
      expect(response.state).toBe("fresh");
      expect(response.cache).toBe("no-store");
      expect(response.exposed.toLowerCase().split(/,\s*/)).toEqual(
        expect.arrayContaining(["x-existing", "x-ncd-source-cut", "x-ncd-data-state"])
      );
      expect(
        response.exposed
          .toLowerCase()
          .split(/,\s*/)
          .filter((name) => name === "x-ncd-data-state")
      ).toHaveLength(1);
    }
    expect(responses[0].body.result).toEqual([
      { service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 },
    ]);
    expect(responses[1].body.result.map(({ qtyOfPatient, avg }) => [qtyOfPatient, avg])).toEqual(Array(6).fill([0, 0]));
    expect(responses[2].body.result.map(({ qtyOfExpense, avg }) => [qtyOfExpense, avg])).toEqual(Array(6).fill([0, 0]));
    expect(responses[3].body.result.map(({ data }) => data[11])).toEqual([7, 2, 1, 1, 1, 1, 1]);
    expect(responses[4].body.result.map(({ data }) => data[11])).toEqual([0, 0, 0, 0, 2]);
    expect(responses[5].body.result.map(({ data }) => data[11])).toEqual([1, 0, 0, 0, 0, 0]);
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    for (const [index, endpoint] of VIEWS.entries()) {
      const selected = await reader.read({ ...CONTEXT, route: `${endpoint}/snapshot` }, ({ snapshot }) =>
        snapshot(endpoint)
      );
      expect(selected).toMatchObject({
        result: responses[index].body.result,
        source: { sourceCutAt: CLOCK.toISOString(), state: "fresh" },
      });
    }
    expect(report.components.snapshots.complete).toBe(true);
    expect(report.complete).toBe(false);
    await expect(builder.publish(report.generationId)).rejects.toThrow(/incomplete/);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps nonempty snapshots and baseline loose Card/Bar versus strict graph selection without a live fallback", async () => {
  const connection = await openFixture();
  const cut = sealSnapshotFixture();
  let app;
  try {
    const report = await createBuilder({
      db: connection.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({ db: connection.db, generationId: report.generationId, clock: SNAPSHOT_CLOCK });
    const responses = await Promise.all(ROUTES.map((route) => post(app, route, SNAPSHOT_REQUEST)));
    expect(responses.map(({ status }) => status)).toEqual(Array(6).fill(200));
    expect(responses[0].body.result).toEqual([
      { service_count: 9, patient_count: 6, expense: 370, hcode_count: 2, avg_service: 1.5, avg_expense: 61.67 },
    ]);
    expect(responses[1].body.result.map(({ qtyOfPatient, avg }) => [qtyOfPatient, avg])).toEqual([
      [2, 2],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(responses[2].body.result.map(({ qtyOfExpense, avg }) => [qtyOfExpense, avg])).toEqual([
      [100, 50],
      [10, 10],
      [50, 50],
      [60, 60],
      [70, 70],
      [80, 80],
    ]);
    expect(responses[3].body.result.map(({ data }) => data[11])).toEqual([7, 2, 1, 1, 1, 1, 1]);
    expect(responses.every(({ sourceCut, state }) => sourceCut === SNAPSHOT_CLOCK && state === "fresh")).toBe(true);
    await connection.db.collection("patients_snapshots").deleteMany({ generationId: report.generationId });
    for (const value of ["", false, 0, []]) {
      const request = {
        startDate: ["2024-01-07"],
        endDate: ["2024-01-09"],
        area: value,
        province: value,
        district: value,
        hcode: value,
      };
      for (const route of ROUTES.slice(0, 3)) expect((await post(app, route, request)).status).toBe(503);
    }
    for (const value of [undefined, null, false, 0]) {
      for (const route of ROUTES.slice(3))
        expect((await post(app, route, { ...SNAPSHOT_REQUEST, area: value })).status).toBe(200);
    }
    for (const value of [undefined, null]) {
      for (const route of ROUTES.slice(0, 3))
        expect((await post(app, route, { ...SNAPSHOT_REQUEST, area: value })).status).toBe(200);
    }
    for (const route of ROUTES.slice(3)) expect((await post(app, route, SNAPSHOT_REQUEST)).status).toBe(503);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("normalizes compatible stored Card and expense views from the same unrounded facts as live requests", async () => {
  const connection = await openFixture();
  const cut = sealSnapshotFixture(
    [
      summary({
        dm_cid_count: ["one", "two"],
        ht_cid_count: ["one"],
        ca_cid_count: ["two"],
        psy_cid_count: ["one"],
        hd_cvd_cid_count: ["two"],
        dm_uid_count: 4,
        ht_uid_count: 1,
        copd_uid_count: 1,
        ca_uid_count: 1,
        psy_uid_count: 1,
        hd_cvd_uid_count: 1,
        dm_expense: Decimal128.fromString("1.005"),
        ht_expense: Decimal128.fromString("2.675"),
        copd_expense: Decimal128.fromString("12.345"),
        ca_expense: Decimal128.fromString("-1.005"),
        psy_expense: Decimal128.fromString("0.004"),
        hd_cvd_expense: Decimal128.fromString("0.004"),
      }),
    ],
    { dataset: "summary-fixture" }
  );
  let app;
  try {
    const report = await createBuilder({
      db: connection.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({ db: connection.db, generationId: report.generationId, clock: SNAPSHOT_CLOCK });
    const stored = await Promise.all(ROUTES.slice(0, 3).map((route) => post(app, route, SNAPSHOT_REQUEST)));
    const live = await Promise.all(
      ROUTES.slice(0, 3).map((route) => post(app, route, { startDate: "2024-01-08", endDate: "2024-01-08" }))
    );
    expect(stored.map(({ status, body }) => ({ status, body }))).toEqual(
      live.map(({ status, body }) => ({ status, body }))
    );
    expect(stored[0].body.result).toEqual([
      { service_count: 9, patient_count: 2, expense: 15.03, hcode_count: 1, avg_service: 4.5, avg_expense: 7.51 },
    ]);
    expect(stored[2].body.result.map(({ qtyOfExpense, avg }) => [qtyOfExpense, avg])).toEqual([
      [1.01, 0.5],
      [2.68, 2.68],
      [12.35, 0],
      [-1.01, -1.01],
      [0, 0],
      [0, 0],
    ]);
    expect(stored.every(({ sourceCut, state }) => sourceCut === SNAPSHOT_CLOCK && state === "unknown")).toBe(true);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("updates live response freshness at the 24-hour boundary without caching or treating future or unverified coverage as fresh", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const report = await createBuilder({ db: connection.db, clock: () => CLOCK, timeZone: "UTC" }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    let reference;
    let etags = [];
    for (const [clock, state] of [
      ["2024-01-03T00:00:00.000Z", "fresh"],
      ["2024-01-04T00:00:00.000Z", "fresh"],
      ["2024-01-04T00:00:00.001Z", "stale"],
      ["2024-01-02T23:59:59.999Z", "unknown"],
    ]) {
      app = await startApplication({ db: connection.db, generationId: report.generationId, clock });
      const responses = await Promise.all(
        ROUTES.map((route, index) =>
          post(
            app,
            route,
            { startDate: "2024-01-01", endDate: "2024-01-02" },
            etags[index] ? { "if-none-match": etags[index] } : {}
          )
        )
      );
      const bodies = responses.map(({ status, body }) => ({ status, body }));
      reference ??= bodies;
      expect(bodies).toEqual(reference);
      expect(
        responses.every(
          (response) =>
            response.status === 200 &&
            response.sourceCut === CLOCK.toISOString() &&
            response.state === state &&
            response.cache === "no-store"
        )
      ).toBe(true);
      etags = responses.map(({ etag }) => etag);
      await app.close();
      app = null;
    }
    await connection.db
      .collection("patients_generations")
      .updateOne({ _id: report.generationId }, { $set: { "source.rawComplete": false } });
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    for (const route of ROUTES) {
      const response = await post(app, route, { startDate: "2024-01-01", endDate: "2024-01-02" });
      expect(response.state).toBe("unknown");
      expect(response.sourceCut).toBe(CLOCK.toISOString());
    }
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps the Builder's captured local snapshot periods when later requests use another clock or timezone", async () => {
  const connection = await openFixture();
  const cut = sealSnapshotFixture([summary({ year: 2026, month: 11, dm_cid_count: ["one"], dm_uid_count: 1 })], {
    dataset: "summary-fixture",
  });
  let app;
  try {
    for (const [timeZone, expected] of [
      ["UTC", 0],
      ["Asia/Bangkok", 1],
    ]) {
      const report = await createBuilder({
        db: connection.db,
        clock: () => new Date("2026-10-31T17:00:00.000Z"),
        timeZone,
      }).build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
      app = await startApplication({
        db: connection.db,
        generationId: report.generationId,
        clock: "2028-04-01T00:00:00.000Z",
        timeZone: "UTC",
      });
      const response = await post(app, "graph-disease-pt", SNAPSHOT_REQUEST);
      expect(response.status).toBe(200);
      expect(response.body.result[1].data).toEqual([...Array(11).fill(0), expected]);
      expect(response.sourceCut).toBe(SNAPSHOT_CLOCK);
      expect(response.state).toBe("unknown");
      await app.close();
      app = null;
    }
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("rejects a failed full snapshot stage while retaining previous readable views and their actual source time", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  const bad = sealSnapshotFixture([summary({ dm_expense: 1 })], { dataset: "summary-fixture" });
  let app;
  try {
    const builder = createBuilder({ db: connection.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, cut.comparisonContext);
    app = await startApplication({
      db: connection.db,
      generationId: report.generationId,
      clock: "2024-01-05T00:00:00.000Z",
    });
    const request = { ...SNAPSHOT, endDate: "2024-01-05" };
    const before = await Promise.all(ROUTES.map((route) => post(app, route, request)));
    await expect(builder.build(bad.sourceCut, FIXTURE_BUDGET, bad.comparisonContext)).rejects.toThrow(
      "Baseline Card presentation failed"
    );
    const after = await Promise.all(ROUTES.map((route) => post(app, route, request)));
    expect(after).toEqual(before);
    expect(
      after.every(
        ({ status, sourceCut, state }) => status === 200 && sourceCut === CLOCK.toISOString() && state === "stale"
      )
    ).toBe(true);
  } finally {
    await app?.close();
    cut.close();
    bad.close();
    await connection.close();
  }
}, 60000);

it("keeps the baseline snapshot producer's Date string interpolation at an intraday build boundary", async () => {
  const connection = await openFixture();
  const clock = "2024-01-09T05:00:00.500Z";
  const cut = sealSnapshotFixture(
    [summary({ date: new Date("2024-01-09T05:00:00.250Z"), dm_cid_count: ["one"], dm_uid_count: 1 })],
    {
      dataset: "summary-fixture",
      manifestOverrides: {
        history: { start: "2024-01-07T00:00:00.000Z", end: "2024-01-09T23:59:59.999Z" },
        sourceCutAt: clock,
      },
    }
  );
  let app;
  try {
    const report = await createBuilder({ db: connection.db, clock: () => new Date(clock), timeZone: "UTC" }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId, clock });
    const stored = await post(app, "card", SNAPSHOT_REQUEST);
    expect(stored.status).toBe(200);
    expect(stored.body.result).toEqual([
      { service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 },
    ]);
    const live = await post(app, "card", { startDate: "2024-01-07", endDate: clock });
    expect(live.body.result[0].patient_count).toBe(1);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("reports an accepted BSON Date source cut as its actual ISO timestamp for live and stored responses", async () => {
  const connection = await openFixture();
  const cut = sealFixture(undefined, { manifestOverrides: { sourceCutAt: CLOCK } });
  let app;
  try {
    const report = await createBuilder({ db: connection.db, clock: () => CLOCK, timeZone: "UTC" }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    for (const request of [SNAPSHOT, { startDate: "2024-01-01", endDate: "2024-01-02" }]) {
      for (const route of ROUTES) {
        const response = await post(app, route, request);
        expect(response.status).toBe(200);
        expect(response.sourceCut).toBe(CLOCK.toISOString());
        expect(response.state).toBe("fresh");
      }
    }
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("keeps the first selected historical view's periods and older or unknown provenance within a newer generation", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const report = await createBuilder({ db: connection.db, clock: () => CLOCK }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    const snapshots = connection.db.collection("patients_snapshots");
    const original = await snapshots.findOne({ generationId: report.generationId });
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const initial = await Promise.all(ROUTES.map((route) => post(app, route)));
    const historical = storedFixture(original, (document) => {
      document.provenance.source.sourceCutAt = "2020-01-01T00:00:00.000Z";
      document.provenance.clock = new Date("2020-01-02");
      document.provenance.periods = Array.from({ length: 12 }, (_, i) => ({ year: 2019, month: i + 1 }));
    });
    await snapshots.replaceOne({ _id: original._id }, historical);
    const second = storedFixture(original, (document) => {
      document._id = "second-not-selected";
      document.key = "main";
      for (const endpoint of VIEWS) document.views[endpoint] = [];
    });
    await snapshots.insertOne(second);
    await connection.db
      .collection("patients_generations")
      .updateOne({ _id: report.generationId }, { $set: { "inventory.snapshotDocuments": 2 } });
    for (const [index, route] of ROUTES.entries()) {
      const response = await post(app, route);
      expect(response.body).toEqual(initial[index].body);
      expect(response.sourceCut).toBe("2020-01-01T00:00:00.000Z");
      expect(response.state).toBe("stale");
    }
    for (const source of [
      { sourceCutAt: null, coverageVerified: false },
      { sourceCutAt: "2024-01-03T00:00:00.000Z", coverageVerified: false },
      { sourceCutAt: "2024-01-04T00:00:00.000Z", coverageVerified: true },
    ]) {
      const unknown = storedFixture(historical, (document) => {
        document.provenance.source = source;
      });
      await snapshots.replaceOne({ _id: original._id }, unknown);
      for (const [index, route] of ROUTES.entries()) {
        const response = await post(app, route);
        expect(response.body).toEqual(initial[index].body);
        expect(response.sourceCut).toBe(source.sourceCutAt);
        expect(response.state).toBe("unknown");
      }
    }
    const reader = createReader({ db: connection.db, generationId: report.generationId, validationOnly: true });
    await expect(
      reader.read({ ...CONTEXT, route: "card/snapshot", timeoutMS: 60001 }, ({ snapshot }) => snapshot("card"))
    ).rejects.toThrow(/budget/);
    await expect(
      reader.read({ ...CONTEXT, route: "card/snapshot", signal: AbortSignal.abort() }, ({ snapshot }) =>
        snapshot("card")
      )
    ).rejects.toThrow(/cancellation/);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);

it("preserves valid stored empty results and rejects full-view absence, incompatible provenance and unsafe output on every route", async () => {
  const connection = await openFixture();
  const cut = sealFixture();
  let app;
  try {
    const report = await createBuilder({ db: connection.db, clock: () => CLOCK }).build(
      cut.sourceCut,
      FIXTURE_BUDGET,
      cut.comparisonContext
    );
    app = await startApplication({ db: connection.db, generationId: report.generationId });
    const snapshots = connection.db.collection("patients_snapshots");
    const original = await snapshots.findOne({ generationId: report.generationId });
    const validEmpty = storedFixture(original, (document) => {
      for (const endpoint of VIEWS) document.views[endpoint] = [];
    });
    await snapshots.replaceOne({ _id: original._id }, validEmpty);
    for (const route of ROUTES) {
      const response = await post(app, route);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: true, message: "success", result: [] });
      expect(response.state).toBe("fresh");
    }
    const cases = [
      (document) => {
        document.views.card = null;
      },
      (document) => {
        delete document.views.card;
      },
      (document) => {
        document.versions.arithmetic = "old";
      },
      (document) => {
        document.complete = false;
      },
      (document) => {
        document.provenance.source.sourceCutAt = "invalid";
      },
      (document) => {
        document.provenance.periods = [];
      },
      (document) => {
        document.views.card[0].expense = 0.001;
      },
      (document) => {
        document.views.card[0].expense = Infinity;
      },
      (document) => {
        document.views.card[0].patient_count = Number.MAX_SAFE_INTEGER + 1;
      },
      (document) => {
        document.views["patients-bar"][0].avg = "invalid-service-average";
      },
      (document) => {
        document.views.card[0].service_count = "invalid-service-total";
      },
      (document) => {
        document.views.card[0].avg_service = "invalid-service-average";
      },
      (document) => {
        document.views.card[0].generationId = "not-a-public-field";
      },
      (document) => {
        document.provenance.selection.range.date.$lte = "invalid";
      },
    ];
    for (const changes of cases) {
      await snapshots.replaceOne({ _id: original._id }, storedFixture(original, changes));
      for (const route of ROUTES) {
        const response = await post(app, route);
        expect({ status: response.status, body: response.body }, String(changes)).toEqual({
          status: 503,
          body: { status: false, message: "Read model unavailable" },
        });
        expect(response.sourceCut).toBe(null);
        expect(response.state).toBe("unknown");
        expect(response.cache).toBe("no-store");
      }
    }
    await snapshots.replaceOne({ _id: original._id }, original);
    await snapshots.updateOne({ _id: original._id }, { $set: { "views.card": [] } });
    for (const route of ROUTES) expect((await post(app, route)).status).toBe(503);
    await snapshots.deleteOne({ _id: original._id });
    for (const route of ROUTES) expect((await post(app, route)).status).toBe(503);
  } finally {
    await app?.close();
    cut.close();
    await connection.close();
  }
}, 60000);
