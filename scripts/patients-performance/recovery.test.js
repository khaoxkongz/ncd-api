import { expect, it } from "vite-plus/test";
import { MongoClient } from "mongodb";
import { openFixture } from "./contract.cjs";
import { startApplication } from "./application.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { openTransport } from "./mongo-transport.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
const { startWorker } = createRequire(import.meta.url)("../../src/modules/patients/read-model/supervision.js");

const managed = (cut) => ({ ...cut.comparisonContext, comparisonOnly: false });
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
async function page(app) {
  return Promise.all(
    ROUTES.map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: "2024-01-07", endDate: "2024-01-08" }),
      });
      return {
        status: response.status,
        body: await response.json(),
        source: response.headers.get("x-ncd-source-cut"),
        state: response.headers.get("x-ncd-data-state"),
      };
    })
  );
}

it("rejects an unrelated real Worker paired with a live Builder incarnation", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const cut = sealSnapshotFixture();
  const incarnation = randomUUID();
  let original, unrelated;
  try {
    original = new Worker(fileURLToPath(new URL("./recovery-worker.cjs", import.meta.url)), {
      workerData: {
        patientsWorker: incarnation,
        uri: transport.uri,
        database: fixture.db.databaseName,
        sourceCut: cut.sourceCut,
        context: managed(cut),
        budget: FIXTURE_BUDGET,
        clock: SNAPSHOT_CLOCK,
      },
    });
    const reached = transport.arm((command) => command.createIndexes === "patients_identity");
    original.postMessage("start");
    await reached;
    unrelated = new Worker("require('node:worker_threads').parentPort.on('message', () => {});", { eval: true });
    expect(() => createBuilder({ db: fixture.db, workers: [{ worker: unrelated, incarnation }] })).toThrow(
      /supervised|registration/
    );
    await unrelated.terminate();
    await expect(createBuilder({ db: fixture.db }).build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(
      /fenced builder/
    );
  } finally {
    await original?.terminate();
    await unrelated?.terminate();
    transport.release();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("retries a repaired exact transport in its occupied slot even when its first scan completed no stage", async () => {
  const fixture = await openFixture();
  const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
  const cutAt = "2024-01-09T04:00:00.000Z";
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: cutAt,
      availability: { mutationAvailableThrough: cutAt, exportAvailableAt: cutAt, evidence: "finite-source-v1" },
    },
  });
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, managed(previous));
    const active = await builder.publish(old, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T05:00:00.000Z" });
    const before = await page(app);
    const bytes = fs.readFileSync(cut.sourceCut.filename);
    fs.chmodSync(cut.sourceCut.filename, 0o600);
    fs.writeFileSync(cut.sourceCut.filename, bytes.subarray(0, bytes.length - 1));
    const request = { cutAt, expectedActive: active, acquire: async () => cut.sourceCut };
    const failed = await builder.refresh(request, FIXTURE_BUDGET, managed(cut)).catch((error) => error);
    expect(failed.report.status).toBe("failed");
    expect(await page(app)).toEqual(before);
    fs.writeFileSync(cut.sourceCut.filename, bytes);
    const recovered = await builder.refresh(
      { ...request, resumeRunId: failed.report.runId },
      FIXTURE_BUDGET,
      managed(cut)
    );
    expect(recovered.generationId).toBe(failed.report.generationId);
    expect(recovered.candidate.recovery.verifiedGroups).toEqual([]);
    expect((await page(app)).every(({ status, source }) => status === 200 && source === cutAt)).toBe(true);
  } finally {
    await app?.close();
    previous.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it.each(["patients_identity", "patients_snapshots"])(
  "keeps all six old responses when %s rejects real stage output, then resumes safely",
  async (collection) => {
    const fixture = await openFixture();
    const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
    const cut = sealSnapshotFixture();
    let app;
    try {
      const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
      const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, managed(previous));
      const active = await builder.publish(old, null);
      app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T05:00:00.000Z" });
      const before = await page(app);
      await fixture.db.command({ collMod: collection, validator: { $expr: { $eq: [1, 0] } } });
      const failed = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut)).catch((error) => error);
      expect(failed.code).toBe(121);
      expect(await page(app)).toEqual(before);
      await fixture.db.command({ collMod: collection, validator: {} });
      const recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
      expect(recovered.generationId).toBe(failed.generationId);
      expect(recovered.recovery.verifiedGroups).toEqual(
        collection === "patients_identity" ? ["A", "B"] : ["A", "B", "C"]
      );
      await builder.publish(recovered, active);
      expect((await page(app)).map(({ status, body }) => ({ status, body }))).toEqual(
        before.map(({ status, body }) => ({ status, body }))
      );
    } finally {
      await app?.close();
      previous.close();
      cut.close();
      await fixture.close();
    }
  },
  60000
);

it("rejects a real corrupted comparison and replaces its derived output before resuming", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cut = sealSnapshotFixture();
  let pending;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    // Hold the actual Reader descriptor selection. Capacity's earlier projected
    // source-storage inventory is independent of the comparison under fault.
    const reached = transport.arm((command) => command.find === "patients_generations" && !command.projection);
    pending = builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    void pending.catch(() => {});
    await reached;
    await fixture.db.collection("patients_daily").updateMany({}, { $set: { dm_uid_count: 999 } });
    transport.release();
    const failed = await pending.catch((error) => error);
    expect(failed).toBeInstanceOf(Error);
    const replacement = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const recovered = await replacement.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.recovery.verifiedGroups).toEqual(["A", "B"]);
    expect(recovered.generationId).toBe(failed.generationId);
    expect(recovered.validation.patientsBar.equal).toBe(true);
    expect((await replacement.publish(recovered, null)).publicationVersion).toBe("1");
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("adopts the same settled ready candidate after its reply is lost", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cut = sealSnapshotFixture();
  let pending;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const lost = transport.arm(
      (command) =>
        command.update === "patients_model_control" &&
        command.updates[0].u.slots?.some((slot) => slot.state === "ready"),
      "lose"
    );
    pending = builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    void pending.catch(() => {});
    await lost;
    const first = await pending;
    const replacement = createBuilder({
      db: fixture.db,
      clock: () => new Date("2025-01-01"),
      timeZone: "Asia/Bangkok",
    });
    const recovered = await replacement.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.generationId).toBe(first.generationId);
    expect(recovered.recovery.verifiedGroups).toEqual(["D"]);
    await expect(builder.publish(first, null)).rejects.toThrow(/stale|changed/);
    expect((await replacement.publish(recovered, null)).publicationVersion).toBe("1");
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("resolves a committed uncertain publication before retrying acquisition or build", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cutAt = "2024-01-09T04:00:00.000Z";
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: cutAt,
      availability: { mutationAvailableThrough: cutAt, exportAvailableAt: cutAt, evidence: "finite-source-v1" },
    },
  });
  let now = new Date("2024-01-09T04:02:00.000Z"),
    pending;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(now),
      timeZone: "UTC",
    });
    const lost = transport.arm(
      (command) => command.update === "patients_model_control" && command.updates[0].u.active,
      "lose"
    );
    pending = builder.refresh(
      {
        cutAt,
        expectedActive: null,
        acquire: async () => {
          now = new Date("2024-01-09T04:03:00.000Z");
          return cut.sourceCut;
        },
      },
      FIXTURE_BUDGET,
      managed(cut)
    );
    void pending.catch(() => {});
    await lost;
    void transport.arm((command) => command.find === "patients_model_control", {
      hold: false,
      reply: { ok: 0, code: 13, errmsg: "fixture unavailable observation" },
    });
    now = new Date("2024-01-09T10:03:00.001Z");
    transport.release();
    const failed = await pending.catch((error) => error);
    expect(failed.report.status).toBe("publication-uncertain");
    const replacement = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    let acquired = 0;
    const recovered = await replacement.refresh(
      {
        cutAt,
        expectedActive: null,
        resumeRunId: failed.report.runId,
        acquire: async () => {
          acquired += 1;
          return cut.sourceCut;
        },
      },
      FIXTURE_BUDGET,
      managed(cut)
    );
    expect(acquired).toBe(0);
    expect(recovered.status).toBe("published-reconciled");
    expect(recovered.active).toEqual({ generationId: failed.report.generationId, publicationVersion: "1" });
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("retains Builder ownership after a real driver write concern failure when independent completion cannot be observed", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
  const cut = sealSnapshotFixture();
  let pending;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const reached = transport.arm(
      (command) => typeof command.update === "string" && command.update.endsWith("_summary"),
      {
        reply: {
          ok: 1,
          writeConcernError: { code: 64, codeName: "WriteConcernFailed", errmsg: "fixture uncertain write concern" },
        },
      }
    );
    pending = builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    void pending.catch(() => {});
    const first = await reached;
    void transport.arm((command) => command.getCmdLineOpts === 1, {
      hold: false,
      reply: { ok: 0, code: 13, errmsg: "fixture observer visibility denied" },
    });
    first.release();
    await expect(pending).rejects.toMatchObject({ name: "MongoWriteConcernError" });
    await expect(builder.cleanup()).rejects.toThrow(/owned|blocked/);
    const competing = createBuilder({ db: fixture.db });
    await expect(competing.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(/fenced builder/);
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("continues one failed cut ledger and its verified stages using only the original remaining reserve", async () => {
  const fixture = await openFixture();
  const cutAt = "2024-01-09T04:00:00.000Z";
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: cutAt,
      availability: { mutationAvailableThrough: cutAt, exportAvailableAt: cutAt, evidence: "finite-source-v1" },
    },
  });
  let now = new Date(SNAPSHOT_CLOCK);
  try {
    await fixture.db.createCollection("patients_month_atoms", { validator: { $expr: { $eq: [1, 0] } } });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const request = { cutAt, expectedActive: null, acquire: async () => cut.sourceCut };
    const failed = await builder.refresh(request, FIXTURE_BUDGET, managed(cut)).catch((error) => error);
    expect(failed.report.status).toBe("failed");
    await fixture.db.command({ collMod: "patients_month_atoms", validator: {} });
    now = new Date("2024-01-09T06:00:00.000Z");
    const recovered = await builder.refresh(
      { ...request, resumeRunId: failed.report.runId },
      FIXTURE_BUDGET,
      managed(cut)
    );
    expect(recovered.runId).toBe(failed.report.runId);
    expect(recovered.startedAt).toBe(SNAPSHOT_CLOCK);
    expect(recovered.acquiredAt).toBe(failed.report.acquiredAt);
    expect(recovered.buildStartedAt).toBe(failed.report.buildStartedAt);
    expect(recovered.candidate.recovery.verifiedGroups).toEqual(["A", "B"]);
    expect(recovered.ledger.queueMS).toBe(3600000);
    expect(recovered.ledger.reserveSpentMS).toBeGreaterThanOrEqual(7200000);
    expect(recovered.active.publicationVersion).toBe("1");
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("reclaims a crashed Builder only after its previously registered real Worker exits and independent Mongo work ends", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const cut = sealSnapshotFixture();
  let worker;
  try {
    const registration = startWorker(
      fileURLToPath(new URL("./recovery-worker.cjs", import.meta.url)),
      {
        uri: transport.uri,
        database: fixture.db.databaseName,
        sourceCut: cut.sourceCut,
        context: managed(cut),
        budget: FIXTURE_BUDGET,
        clock: SNAPSHOT_CLOCK,
      },
      { pauseAt: "B" }
    );
    worker = registration.worker;
    const builder = createBuilder({
      db: fixture.db,
      workers: [registration],
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    worker.postMessage("start");
    expect(await registration.checkpoint).toMatchObject({ group: "B" });
    await worker.terminate();
    const recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.recovery.verifiedGroups).toEqual(["A", "B"]);
    expect((await builder.publish(recovered, null)).generationId).toBe(recovered.generationId);
  } finally {
    await worker?.terminate();
    transport.release();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("retains a crashed Builder while a real pre-server request could still arrive after an empty operation snapshot", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const cut = sealSnapshotFixture();
  let worker;
  try {
    const registration = startWorker(
      fileURLToPath(new URL("./recovery-worker.cjs", import.meta.url)),
      {
        uri: transport.uri,
        database: fixture.db.databaseName,
        sourceCut: cut.sourceCut,
        context: managed(cut),
        budget: FIXTURE_BUDGET,
        clock: SNAPSHOT_CLOCK,
      },
      { pauseAt: "B" }
    );
    worker = registration.worker;
    const builder = createBuilder({
      db: fixture.db,
      workers: [registration],
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    const entered = transport.arm((command) => command.createIndexes === "patients_identity", "hold-request");
    expect(() => registration.resume()).toThrow(/acknowledged checkpoint/);
    worker.postMessage("start");
    await registration.checkpoint;
    registration.resume();
    await entered;
    await worker.terminate();
    await expect(builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(/fenced builder/);
    expect(await builder.cleanup()).toEqual({ removed: [] });
    transport.release();
    let lateIndexObserved = false;
    const observationDeadline = Date.now() + 10000;
    while (!lateIndexObserved && Date.now() < observationDeadline) {
      try {
        lateIndexObserved = (await fixture.db.collection("patients_identity").listIndexes().toArray()).some(
          (index) => index.key.ordinal === 1
        );
      } catch (error) {
        if (error.code !== 26) throw error;
      }
      if (!lateIndexObserved) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(lateIndexObserved).toBe(true);
    await expect(builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(/fenced builder/);
  } finally {
    await worker?.terminate();
    transport.release();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it.each(["insert", "update"])(
  "reconciles a genuinely lost cut-ledger %s reply without abandoning or restarting its allocation",
  async (commandName) => {
    const fixture = await openFixture();
    const transport = await openTransport();
    const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
    const cutAt = "2024-01-09T04:00:00.000Z";
    const cut = sealSnapshotFixture(undefined, {
      manifestOverrides: {
        sourceCutAt: cutAt,
        availability: { mutationAvailableThrough: cutAt, exportAvailableAt: cutAt, evidence: "finite-source-v1" },
      },
    });
    let pending;
    try {
      await client.connect();
      const builder = createBuilder({
        db: client.db(fixture.db.databaseName),
        clock: () => new Date(SNAPSHOT_CLOCK),
        timeZone: "UTC",
      });
      const lost = transport.arm((command) => command[commandName] === "patients_refresh_runs", "lose");
      pending = builder.refresh(
        { cutAt, expectedActive: null, acquire: async () => cut.sourceCut },
        FIXTURE_BUDGET,
        managed(cut)
      );
      void pending.catch(() => {});
      await lost;
      const report = await pending;
      expect(report.status).toBe("published");
      expect(report.startedAt).toBe(SNAPSHOT_CLOCK);
      expect(report.ledger).toMatchObject({
        deadlineAt: "2024-01-09T16:00:00.000Z",
        reserveLimitMS: 14400000,
        queueMS: 3600000,
      });
    } finally {
      transport.release();
      await pending?.catch(() => {});
      await client.close();
      await transport.close();
      cut.close();
      await fixture.close();
    }
  },
  60000
);

it("replaces corrupt finalized summaries instead of trusting their completed checkpoint", async () => {
  const fixture = await openFixture();
  const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
  const cut = sealSnapshotFixture();
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, managed(previous));
    const active = await builder.publish(old, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T05:00:00.000Z" });
    const before = await page(app);
    await fixture.db.command({ collMod: "patients_month_atoms", validator: { $expr: { $eq: [1, 0] } } });
    const failed = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut)).catch((error) => error);
    expect(failed.code).toBe(121);
    expect(await page(app)).toEqual(before);
    const prefix = `patients_stage_${failed.generationId.replaceAll("-", "")}`;
    await fixture.db.collection(`${prefix}_summary`).updateMany({}, { $set: { dm_cid_count: ["fixture-corruption"] } });
    await fixture.db.command({ collMod: "patients_month_atoms", validator: {} });
    const recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.recovery.verifiedGroups).toEqual(["A"]);
    await builder.publish(recovered, active);
    const after = await page(app);
    expect(after.map(({ status, body }) => ({ status, body }))).toEqual(
      before.map(({ status, body }) => ({ status, body }))
    );
    expect(after.every(({ source }) => source === SNAPSHOT_CLOCK)).toBe(true);
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [old.generationId] });
    expect(await builder.cleanup(old.generationId)).toEqual({ removed: [] });
  } finally {
    await app?.close();
    previous.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("refuses a changed immutable cut on ledger resume and never renews an exhausted reserve", async () => {
  const fixture = await openFixture();
  const cutAt = "2024-01-09T04:00:00.000Z";
  const options = {
    manifestOverrides: {
      sourceCutAt: cutAt,
      availability: { mutationAvailableThrough: cutAt, exportAvailableAt: cutAt, evidence: "finite-source-v1" },
    },
  };
  const first = sealSnapshotFixture(undefined, options),
    changed = sealSnapshotFixture(undefined, options);
  let now = new Date(cutAt);
  try {
    await fixture.db.createCollection("patients_month_atoms", { validator: { $expr: { $eq: [1, 0] } } });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const request = { cutAt, expectedActive: null, acquire: async () => first.sourceCut };
    const failed = await builder.refresh(request, FIXTURE_BUDGET, managed(first)).catch((error) => error);
    expect(failed.report.status).toBe("failed");
    await expect(
      builder.refresh(
        { ...request, resumeRunId: failed.report.runId, acquire: async () => changed.sourceCut },
        FIXTURE_BUDGET,
        managed(changed)
      )
    ).rejects.toThrow(/source changed/);
    now = new Date("2024-01-09T08:00:00.001Z");
    let acquired = 0;
    await expect(
      builder.refresh(
        {
          ...request,
          resumeRunId: failed.report.runId,
          acquire: async () => {
            acquired += 1;
            return first.sourceCut;
          },
        },
        FIXTURE_BUDGET,
        managed(first)
      )
    ).rejects.toThrow(/reserve exhausted/);
    expect(acquired).toBe(0);
  } finally {
    first.close();
    changed.close();
    await fixture.close();
  }
}, 60000);

it("records non-Error acquisition rejection as a safe durable refresh failure", async () => {
  const fixture = await openFixture();
  try {
    const builder = createBuilder({
      db: fixture.db,
      clock: () => new Date("2024-01-09T04:00:00.000Z"),
      timeZone: "UTC",
    });
    await expect(
      builder.refresh(
        {
          cutAt: "2024-01-09T04:00:00.000Z",
          expectedActive: null,
          acquire: async () => {
            throw null;
          },
        },
        FIXTURE_BUDGET
      )
    ).rejects.toMatchObject({
      name: "Error",
      report: { status: "failed", failure: { name: "Error", reason: "Refresh phase failed" } },
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it.each(["lost-transport", "terminal-error"])(
  "handles a %s staging-drop outcome with proof required before finishing verified output",
  async (outcome) => {
    const fixture = await openFixture();
    const transport = await openTransport();
    const client = new MongoClient(transport.uri, { serverSelectionTimeoutMS: 3000 });
    const cut = sealSnapshotFixture();
    let pending;
    try {
      await client.connect();
      const builder = createBuilder({
        db: client.db(fixture.db.databaseName),
        clock: () => new Date(SNAPSHOT_CLOCK),
        timeZone: "UTC",
      });
      const lost = transport.arm(
        (command) => typeof command.drop === "string" && command.drop.endsWith("_raw"),
        outcome === "lost-transport"
          ? "lose"
          : { hold: false, reply: { ok: 0, code: 1, errmsg: "fixture terminal drop reply" } }
      );
      pending = builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
      void pending.catch(() => {});
      await lost;
      const failed = await pending.catch((error) => error);
      expect(failed).toBeInstanceOf(Error);
      const replacement = createBuilder({
        db: fixture.db,
        clock: () => new Date("2025-01-01"),
        timeZone: "Asia/Bangkok",
      });
      if (outcome === "lost-transport") {
        await expect(replacement.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toThrow(/fenced builder/);
        await expect(replacement.cleanup(failed.generationId)).rejects.toThrow(/owned|blocked/);
        return;
      }
      const recovered = await replacement.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
      expect(recovered.recovery.verifiedGroups).toEqual(["D"]);
      expect(recovered.generationId).toBe(failed.generationId);
      expect((await replacement.publish(recovered, null)).generationId).toBe(recovered.generationId);
    } finally {
      transport.release();
      await pending?.catch(() => {});
      await client.close();
      await transport.close();
      cut.close();
      await fixture.close();
    }
  },
  60000
);

it("resumes the same immutable cut from verified finalized summaries after a real monthly-stage failure", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    await fixture.db.createCollection("patients_month_atoms", { validator: { $expr: { $eq: [1, 0] } } });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const failed = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut)).catch((error) => error);
    expect(failed).toMatchObject({ code: 121 });
    await fixture.db.command({ collMod: "patients_month_atoms", validator: {} });
    const replacement = createBuilder({
      db: fixture.db,
      clock: () => new Date("2025-01-01"),
      timeZone: "Asia/Bangkok",
    });
    const recovered = await replacement.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.recovery).toMatchObject({
      verifiedGroups: ["A", "B"],
      capturedClock: SNAPSHOT_CLOCK,
      timeZone: "UTC",
    });
    expect(recovered.generationId).toBe(failed.generationId);
    const active = await replacement.publish(recovered, null);
    expect(active.generationId).toBe(recovered.generationId);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects changed recovery budgets without poisoning a later compatible retry", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    await fixture.db.createCollection("patients_month_atoms", { validator: { $expr: { $eq: [1, 0] } } });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    await expect(builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut))).rejects.toMatchObject({ code: 121 });
    await fixture.db.command({ collMod: "patients_month_atoms", validator: {} });
    await expect(
      builder.build(
        cut.sourceCut,
        { ...FIXTURE_BUDGET, maxStorageBytes: FIXTURE_BUDGET.maxStorageBytes + 1 },
        managed(cut)
      )
    ).rejects.toThrow(/fixed budget changed/);
    const recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, managed(cut));
    expect(recovered.complete).toBe(true);
    expect(recovered.recovery.verifiedGroups).toEqual(["A", "B"]);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);
