import { expect, it } from "vite-plus/test";
import { openFixture } from "./contract.cjs";
import { FIXTURE_BUDGET, rawDocuments } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { startApplication } from "./application.cjs";
import { openTransport } from "./mongo-transport.cjs";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { BSON, Long, MongoClient } from "mongodb";

const CONTEXT = {
  route: "card/live",
  backendMode: "candidate-validation",
  clock: new Date(SNAPSHOT_CLOCK),
  timeZone: "UTC",
};
const SELECTION = { date: { $gte: new Date("2024-01-07"), $lte: new Date("2024-01-08") } };
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const managed = (cut) => ({ ...cut.comparisonContext, comparisonOnly: false });
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function changedCut() {
  const documents = rawDocuments().map((row) => ({
    ...row,
    claim_date: new Date(row.claim_date.getTime() + 6 * 86400000),
  }));
  documents.push({ ...documents[0], _id: "new-raw-row", cid: "new-patient", transaction_uid: "new-service" });
  return sealSnapshotFixture(documents, {
    manifestOverrides: { sourceVersion: "corrected-cut-v2", sourceCutAt: "2024-01-10T00:00:00.000Z" },
  });
}
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Observed fixture state did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function page(app, request = SNAPSHOT_REQUEST) {
  return Promise.all(
    ROUTES.map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      return { status: response.status, body: await response.json(), source: response.headers.get("x-ncd-source-cut") };
    })
  );
}

it("publishes only a complete checked raw generation and returns all six responses from the pinned active identity", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(candidate.complete).toBe(true);
    expect(candidate.state).toBe("ready");
    const active = await builder.publish(candidate, null);
    expect(active.generationId).toBe(candidate.generationId);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    const facts = await reader.read(CONTEXT, ({ rangeFacts }) => rangeFacts(SELECTION));
    expect([facts.cardPatientCount, facts.hospitalCount, facts.cardService]).toEqual([6, 2, 9]);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    const responses = await page(app);
    expect(responses.map(({ status }) => status)).toEqual(Array(6).fill(200));
    expect(responses[0].body.result).toEqual([
      { service_count: 9, patient_count: 6, expense: 370, hcode_count: 2, avg_service: 1.5, avg_expense: 61.67 },
    ]);
    expect(responses.every(({ source }) => source === SNAPSHOT_CLOCK)).toBe(true);
    await expect(builder.publish(candidate, null)).resolves.toEqual(active);
    await expect(builder.publish({ ...candidate, seal: "changed" }, null)).rejects.toThrow();
    await expect(
      createReader({ db: fixture.db, generationId: candidate.generationId, validationOnly: true }).read(
        CONTEXT,
        () => null
      )
    ).rejects.toThrow(/bypass/);
  } finally {
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("keeps shared Mongo work protected when an actual HTTP caller disconnects during a publication", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const first = sealSnapshotFixture(),
    second = changedCut();
  const cancellation = new AbortController();
  let app, abandoned, surviving;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: SNAPSHOT_CLOCK,
      transportUri: transport.uri,
    });
    const reached = transport.arm((command) => command.aggregate === "patients_daily");
    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2024-01-07", endDate: "2024-01-08" }),
    };
    abandoned = fetch(`${app.url}/ncds_api/api/v1/card`, { ...request, signal: cancellation.signal });
    void abandoned.catch(() => {});
    await reached;
    surviving = fetch(`${app.url}/ncds_api/api/v1/card`, request);
    const control = fixture.db.collection("patients_model_control");
    await until(
      async () =>
        (await control.findOne({ _id: "patients" })).pins.filter(
          (pin) => pin.generationId === old.generationId && pin.work
        ).length === 2
    );
    cancellation.abort();
    await expect(abandoned).rejects.toThrow();
    await until(
      async () =>
        (await control.findOne({ _id: "patients" })).pins.filter((pin) => pin.generationId === old.generationId)
          .length === 2
    );
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    await builder.publish(candidate, active);
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    transport.release();
    const response = await surviving;
    expect(response.status).toBe(200);
    expect((await response.json()).result[0].patient_count).toBe(6);
    expect(response.headers.get("x-ncd-source-cut")).toBe(SNAPSHOT_CLOCK);
    await until(
      async () =>
        !(await control.findOne({ _id: "patients" })).pins.some((pin) => pin.generationId === old.generationId)
    );
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
  } finally {
    cancellation.abort();
    transport.release();
    await Promise.allSettled([abandoned, surviving].map((request) => Promise.resolve(request)));
    await app?.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("retains orphan protection after a real worker exits and its lease expires rather than deleting from expiry alone", async () => {
  const fixture = await openFixture();
  const first = sealSnapshotFixture(),
    second = changedCut();
  let worker;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    worker = new Worker(fileURLToPath(new URL("./generation-worker.cjs", import.meta.url)), {
      workerData: { uri: process.env.PATIENTS_TEST_MONGO_URI, database: fixture.db.databaseName },
    });
    const [pinned] = await once(worker, "message");
    expect(pinned).toEqual({ state: "pinned", count: 6 });
    await worker.terminate();
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    await builder.publish(candidate, active);
    await fixture.db
      .collection("patients_model_control")
      .updateOne({ _id: "patients" }, { $set: { "pins.$[].leaseUntil": 0 } });
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    await expect(builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first))).rejects.toThrow(/slots/);
    const facts = await createReader({ db: fixture.db, validationOnly: true }).read(CONTEXT, ({ rangeFacts }) =>
      rangeFacts(SELECTION)
    );
    expect(facts.cardPatientCount).toBe(7);
    expect(
      (await fixture.db.collection("patients_model_control").findOne({ _id: "patients" })).pins.some(
        (pin) => pin.generationId === old.generationId && pin.state === "suspect"
      )
    ).toBe(true);
  } finally {
    await worker?.terminate();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("bounds pins, proposed control bytes and request time while keeping publication independent of reader bookkeeping", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const finishes = Array.from({ length: 64 }, () => deferred());
  const reads = [];
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    const active = await builder.publish(candidate, null);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    let entered = 0;
    for (let i = 0; i < 64; i += 1) {
      reads.push(
        reader.read(CONTEXT, async () => {
          entered += 1;
          await finishes[i].promise;
          return "completed";
        })
      );
      // Hold 64 real concurrent lifetimes without making the boundary fixture
      // an unbounded CAS-contention/RSS benchmark in a parallel test process.
      await until(() => entered === i + 1);
    }
    await expect(reader.read(CONTEXT, () => null)).rejects.toThrow(/pin limit/);
    const control = fixture.db.collection("patients_model_control");
    expect((await control.findOne({ _id: "patients" })).publicationVersion.toString()).toBe(active.publicationVersion);
    for (let i = 0; i < 64; i += 1) {
      finishes[i].resolve();
      expect(await reads[i]).toBe("completed");
    }
    expect(await Promise.all(reads)).toEqual(Array(64).fill("completed"));
    const original = await control.findOne({ _id: "patients" }, { promoteLongs: false });
    const size = BSON.serialize(original).length;
    await control.updateOne({ _id: "patients" }, { $set: { padding: "x".repeat(1048576 - size - 150) } });
    await expect(reader.read(CONTEXT, () => null)).rejects.toThrow(/control/);
    await control.replaceOne({ _id: "patients" }, original);
    await expect(reader.read({ ...CONTEXT, timeoutMS: 60001 }, () => null)).rejects.toThrow(/budget/);
    await expect(
      reader.read({ ...CONTEXT, timeoutMS: 25 }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return null;
      })
    ).rejects.toThrow(/deadline|budget/);
    await until(async () => !(await control.findOne({ _id: "patients" })).pins.length);
    await control.updateOne({ _id: "patients" }, { $set: { revision: Long.MAX_VALUE } });
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    expect((await page(app)).map(({ status, body }) => ({ status, body }))).toEqual(
      ROUTES.map(() => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
    );
    await control.replaceOne({ _id: "patients" }, original);
  } finally {
    for (const finish of finishes) finish.resolve();
    await Promise.allSettled(reads);
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("retains cancelled callback ownership until it settles and prevents a lazy expense iterator escaping its pin", async () => {
  const fixture = await openFixture();
  const first = sealSnapshotFixture(),
    second = changedCut();
  const entered = deferred(),
    finish = deferred();
  const cancellation = new AbortController();
  let pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    pending = reader.read({ ...CONTEXT, signal: cancellation.signal }, async ({ rangeFacts }) => {
      await rangeFacts(SELECTION);
      entered.resolve();
      await finish.promise;
      return "late";
    });
    void pending.catch(() => {});
    await entered.promise;
    cancellation.abort();
    await expect(pending).rejects.toThrow(/cancellation/);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    await builder.publish(candidate, active);
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    finish.resolve();
    await until(
      async () =>
        !(await fixture.db.collection("patients_model_control").findOne({ _id: "patients" })).pins.some(
          (pin) => pin.generationId === old.generationId
        )
    );
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
    let iterator;
    const row = await reader.read(CONTEXT, async ({ rangeFacts }) => {
      const facts = await rangeFacts(SELECTION);
      iterator = facts.expenseOperands[Symbol.asyncIterator]();
      return iterator.next();
    });
    expect(row.done).toBe(false);
    await expect(iterator.next()).rejects.toThrow(/callback has ended/);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("rejects stale and changed candidates while explicit rollback selects only retained full output or legacy", async () => {
  const fixture = await openFixture();
  const first = sealSnapshotFixture(),
    second = changedCut();
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    await expect(builder.publish(candidate, null)).rejects.toThrow(/Expected active/);
    const snapshots = fixture.db.collection("patients_snapshots");
    const original = await snapshots.findOne({ generationId: candidate.generationId });
    await snapshots.updateOne({ _id: original._id }, { $set: { complete: false } });
    await expect(builder.publish(candidate, active)).rejects.toThrow(/contents/);
    await snapshots.replaceOne({ _id: original._id }, original);
    const next = await builder.publish(candidate, active);
    const rollback = await builder.rollback(old.generationId, next);
    expect(rollback.generationId).toBe(old.generationId);
    expect(rollback.publicationVersion).not.toBe(next.publicationVersion);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    expect((await reader.read(CONTEXT, ({ rangeFacts }) => rangeFacts(SELECTION))).cardPatientCount).toBe(6);
    await expect(builder.rollback(candidate.generationId, next)).rejects.toThrow(/Expected active/);
    await builder.rollback("legacy", rollback);
    await expect(reader.read(CONTEXT, () => null)).rejects.toThrow(/active/);
    expect(await builder.cleanup()).toEqual({
      removed: expect.arrayContaining([old.generationId, candidate.generationId]),
    });
  } finally {
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("does not overlap a fenced builder's real outstanding Mongo command after its lease expires", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cut = sealSnapshotFixture();
  let building;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const competing = createBuilder({ db: fixture.db });
    const reached = transport.arm(
      (command) =>
        typeof command.aggregate === "string" &&
        command.aggregate.startsWith("patients_stage_") &&
        command.aggregate.endsWith("_raw")
    );
    building = builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    void building.catch(() => {});
    await reached;
    await fixture.db
      .collection("patients_model_control")
      .updateOne({ _id: "patients" }, { $set: { "builder.leaseUntil": 0 } });
    await expect(competing.build({}, FIXTURE_BUDGET)).rejects.toThrow(/fenced builder/);
    await expect(competing.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(/fenced builder/);
    transport.release();
    await expect(building).rejects.toThrow(/Stale builder/);
    const cleanup = await builder.cleanup();
    expect(cleanup.removed).toHaveLength(1);
    const candidate = await competing.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    await fixture.db.collection("patients_model_control").updateOne({ _id: "patients" }, { $inc: { fence: Long.ONE } });
    await expect(competing.publish(candidate, null)).rejects.toThrow(/stale/);
  } finally {
    transport.release();
    await building?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("resolves a genuinely lost publication-write reply without double publication or duplicate pins", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cut = sealSnapshotFixture();
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    const lost = transport.arm((command) => command.update === "patients_model_control", "lose");
    const active = await builder.publish(candidate, null);
    await lost;
    expect(active.publicationVersion).toBe("1");
    expect(await builder.publish(candidate, null)).toEqual(active);
    const lostPin = transport.arm((command) => command.update === "patients_model_control", "lose");
    const facts = await createReader({ db: client.db(fixture.db.databaseName), validationOnly: true }).read(
      CONTEXT,
      ({ rangeFacts }) => rangeFacts(SELECTION)
    );
    await lostPin;
    expect(facts.cardPatientCount).toBe(6);
    const state = await fixture.db.collection("patients_model_control").findOne({ _id: "patients" });
    expect(state.publicationVersion.toString()).toBe("1");
    expect(state.pins).toEqual([]);
  } finally {
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("keeps a pinned old response whole across publication and prevents cleanup or a third slot until it completes", async () => {
  const fixture = await openFixture();
  const first = sealSnapshotFixture();
  const second = changedCut();
  const entered = deferred(),
    finish = deferred();
  let app, pending;
  try {
    const builder = createBuilder({
      db: fixture.db,
      clock: () => new Date("2024-01-11T00:00:00.000Z"),
      timeZone: "UTC",
    });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const oldIdentity = await builder.publish(old, null);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    pending = reader.read(CONTEXT, async ({ rangeFacts, monthFacts, snapshot }) => {
      const facts = await rangeFacts(SELECTION);
      entered.resolve();
      await finish.promise;
      const retired = await rangeFacts(SELECTION);
      const months = await monthFacts(
        {},
        Array.from({ length: 12 }, (_, index) => ({
          year: index < 11 ? 2023 : 2024,
          month: index < 11 ? index + 2 : 1,
        }))
      );
      return {
        count: facts.cardPatientCount,
        retiredCount: retired.cardPatientCount,
        monthCount: months.counts[11][0],
        snapshot: await snapshot("card"),
      };
    });
    await entered.promise;
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    const next = await builder.publish(candidate, oldIdentity);
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    await expect(builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first))).rejects.toThrow(/slots/);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T00:00:00.000Z" });
    const newResponses = await page(app, { ...SNAPSHOT_REQUEST, endDate: "2024-01-11" });
    expect(newResponses.map(({ status }) => status)).toEqual(Array(6).fill(200));
    expect(newResponses[0].body.result[0].patient_count).toBe(7);
    expect(newResponses.every(({ source }) => source === "2024-01-10T00:00:00.000Z")).toBe(true);
    finish.resolve();
    const response = await pending;
    expect(response.count).toBe(6);
    expect(response.retiredCount).toBe(6);
    expect(response.monthCount).toBe(2);
    expect(response.snapshot.result[0].patient_count).toBe(6);
    expect(response.snapshot.source.sourceCutAt).toBe(SNAPSHOT_CLOCK);
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
    await expect(builder.rollback(old.generationId, next)).rejects.toThrow();
    const third = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    expect(third.complete).toBe(true);
  } finally {
    finish.resolve();
    await pending?.catch(() => {});
    await app?.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("reselects before data reads when publication and deletion win after active selection but before conditional pinning", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const first = sealSnapshotFixture(),
    second = changedCut();
  let app, pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: SNAPSHOT_CLOCK,
      transportUri: transport.uri,
    });
    const selected = transport.arm((command) => command.find === "patients_model_control" && !command.projection);
    pending = fetch(`${app.url}/ncds_api/api/v1/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2024-01-07", endDate: "2024-01-08" }),
    });
    await selected;
    await builder.publish(candidate, active);
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
    transport.release();
    const response = await pending;
    expect(response.status).toBe(200);
    expect((await response.json()).result[0].patient_count).toBe(7);
    expect(response.headers.get("x-ncd-source-cut")).toBe("2024-01-10T00:00:00.000Z");
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("keeps the independent work pin after every HTTP caller cancels until the real outstanding database reply settles", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const first = sealSnapshotFixture(),
    second = changedCut();
  const cancellation = new AbortController();
  let app, pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: SNAPSHOT_CLOCK,
      transportUri: transport.uri,
    });
    const entered = transport.arm((command) => command.aggregate === "patients_daily");
    pending = fetch(`${app.url}/ncds_api/api/v1/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDate: "2024-01-07", endDate: "2024-01-08" }),
      signal: cancellation.signal,
    });
    void pending.catch(() => {});
    await entered;
    cancellation.abort();
    await expect(pending).rejects.toThrow();
    await builder.publish(candidate, active);
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    transport.release();
    await until(
      async () =>
        !(await fixture.db.collection("patients_model_control").findOne({ _id: "patients" })).pins.some(
          (pin) => pin.generationId === old.generationId
        )
    );
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
  } finally {
    cancellation.abort();
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("keeps an interrupted deletion occupied and retries verified cleanup before allowing its slot to be reused", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const first = sealSnapshotFixture(),
    second = changedCut();
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    const active = await builder.publish(old, null);
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, managed(second));
    const next = await builder.publish(candidate, active);
    const lost = transport.arm((command) => command.delete === "patients_daily", "lose");
    await expect(builder.cleanup(old.generationId)).rejects.toThrow();
    await lost;
    await expect(builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first))).rejects.toThrow(/slots/);
    await expect(builder.rollback(old.generationId, next)).rejects.toThrow();
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
    const fresh = await builder.build(first.sourceCut, FIXTURE_BUDGET, managed(first));
    expect(fresh.complete).toBe(true);
  } finally {
    await client.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 60000);

it("does not release ownership when a callback returns before its real Mongo range work settles", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  let work, read;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    await builder.publish(candidate, null);
    const reader = createReader({ db: fixture.db, validationOnly: true });
    const slow = {
      ...SELECTION,
      $expr: {
        $function: {
          body: "function(){let n=0;for(let i=0;i<1000000;i++){n=(n+i)%1000003;}return n>=0;}",
          args: [],
          lang: "js",
        },
      },
    };
    let workDone = false;
    read = reader.read(CONTEXT, ({ rangeFacts }) => {
      work = rangeFacts(slow).finally(() => {
        workDone = true;
      });
      return "callback-returned";
    });
    expect(await read).toBe("callback-returned");
    expect(workDone).toBe(true);
    expect((await Promise.resolve(work)).cardPatientCount).toBe(6);
  } finally {
    await read?.catch(() => {});
    await work?.catch(() => {});
    cut.close();
    await fixture.close();
  }
}, 60000);
