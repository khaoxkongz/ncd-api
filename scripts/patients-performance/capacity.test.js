import { expect, it } from "vite-plus/test";
import { openFixture } from "./contract.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { policy } from "./capacity-fixture.cjs";
import { MongoClient } from "mongodb";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { openTransport } from "./mongo-transport.cjs";
import { startApplication } from "./application.cjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";
const { startWorker } = createRequire(import.meta.url)("../../src/modules/patients/read-model/supervision.js");

it("keeps finite functional output separate from failed capacity acceptance when operator evidence is absent", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    const report = await createBuilder({
      db: fixture.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
    expect(report.complete).toBe(true);
    expect(report.resources.capacity).toMatchObject({
      acceptance: "failed",
      targetAcceptance: "blocked",
      reasons: expect.arrayContaining(["operator-policy-missing"]),
    });
    expect(report.resources.observation.actor.pid).toBe(process.pid);
    expect(report.resources.observation.coverage).toBe("sampled-not-complete-peak");
    expect(report.resources.observation.peakRssBytes).toBeGreaterThan(0);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects untrusted, expired and inapplicable operator policy before building without confusing source signatures with capacity trust", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    for (const config of [
      { ...policy([cut]), trustedOperators: {} },
      policy([cut], { overrides: { validity: { kind: "window", from: 1, until: 2 } } }),
      { ...policy([cut]), binding: { id: "different-deployment" } },
      policy([cut], { overrides: { scope: "deployment" } }),
    ]) {
      await expect(async () =>
        createBuilder({ db: fixture.db, capacity: config }).build(cut.sourceCut, FIXTURE_BUDGET, {
          ...cut.comparisonContext,
          comparisonOnly: false,
        })
      ).rejects.toThrow(/capacity|Capacity/);
    }
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("requires complete operator topology and mandatory RAM/disk/CPU/IO definitions before accepting a workload", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    const incomplete = policy([cut], {
      overrides: {
        domains: [
          {
            id: "fixture-host",
            kind: "host",
            ram: { allocation: 4 * 1024 ** 3, existingPeak: 0, reservations: 0, totalLimit: 4 * 1024 ** 3 },
            disk: { allocation: 1024 ** 3, existingPeak: 0, reservations: 0, totalLimit: 1024 ** 3 },
            io: [
              {
                id: "write",
                allocation: 1e6,
                existingPeak: 0,
                reservations: 0,
                totalLimit: 1e6,
                unit: "bytes/s",
                windowMS: 1000,
              },
            ],
          },
        ],
      },
    });
    await expect(async () =>
      createBuilder({ db: fixture.db, capacity: incomplete }).build(cut.sourceCut, FIXTURE_BUDGET, {
        ...cut.comparisonContext,
        comparisonOnly: false,
      })
    ).rejects.toThrow(/capacity|Capacity/);
    const report = await createBuilder({
      db: fixture.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
      capacity: policy([cut]),
    }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
    expect(report.complete).toBe(true);
    expect(report.resources.capacity).toMatchObject({ acceptance: "failed", targetAcceptance: "blocked" });
    expect(report.resources.capacity.reasons).toContain("metric-unavailable:fixture-host:ram");
    expect(report.resources.capacity.reasons).toContain("metric-unavailable:fixture-host:response");
    expect(report.resources.capacity.fixedLimits[0]).toMatchObject({
      apiBytes: 268435456,
      builderBytes: 536870912,
      databaseBytes: 1073741824,
      combinedBytes: 3221225472,
      diskBytes: 858993459,
      cpu: 4,
      io: { write: 500000 },
    });
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("does not accept arbitrary complete-peak labels as host or database observation proof", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    const config = policy([cut]);
    config.observe = async () => ({
      domains: [
        {
          id: "fixture-host",
          ...Object.fromEntries(
            ["ram", "disk", "cpu", "io:write"].map((metric) => [
              metric,
              {
                additional: 0,
                total: 0,
                api: 0,
                builder: 0,
                database: 0,
                unit: metric === "cpu" ? "cores" : metric === "io:write" ? "bytes/s" : "bytes",
                windowMS: ["cpu", "io:write"].includes(metric) ? 1000 : undefined,
                coverage: "complete-peak",
                evidence: "some-unverified-string",
              },
            ])
          ),
        },
      ],
    });
    const report = await createBuilder({
      db: fixture.db,
      capacity: config,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
    expect(report.resources.capacity.acceptance).toBe("failed");
    expect(report.resources.capacity.reasons).toContain("observer-proof-unverified");
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("admits aggregate work before data dispatch and retains a disconnected caller until its genuine Mongo command settles", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const transports = [await openTransport(), await openTransport()];
  const clients = transports.map((item) => new MongoClient(item.uri));
  const waiting = [];
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const report = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(report, null);
    const config = policy([cut], {
      overrides: {
        admission: { apiBytes: 128 * 1048576, builderBytes: 4 * 1048576 },
        domains: [
          {
            id: "fixture-host",
            kind: "host",
            ram: { allocation: 4 * 1024 ** 3, existingPeak: 0, reservations: 0, totalLimit: 4 * 1024 ** 3 },
            disk: { allocation: 1024 ** 3, existingPeak: 0, reservations: 0, totalLimit: 1024 ** 3 },
            cpu: { allocation: 8, existingPeak: 0, reservations: 0, totalLimit: 8, unit: "cores", windowMS: 1000 },
            io: [
              {
                id: "write",
                allocation: 1e6,
                existingPeak: 0,
                reservations: 0,
                totalLimit: 1e6,
                unit: "bytes/s",
                windowMS: 1000,
              },
            ],
          },
        ],
      },
    });
    const context = {
      route: "card",
      backendMode: "candidate-validation",
      clock: new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    };
    const cancelled = new AbortController();
    for (const [index, client] of clients.entries()) {
      await client.connect();
      const reached = transports[index].arm((command) => command.find === "patients_generations");
      const reader = createReader({ db: client.db(fixture.db.databaseName), validationOnly: true, capacity: config });
      const request = reader.read(
        { ...context, ...(index === 0 ? { signal: cancelled.signal } : {}) },
        ({ snapshot }) => snapshot("card")
      );
      void request.catch(() => {});
      waiting.push(request);
      await reached;
    }
    cancelled.abort();
    await expect(waiting[0]).rejects.toThrow(/deadline|cancellation/);
    const reader = createReader({ db: fixture.db, validationOnly: true, capacity: config });
    await expect(reader.read(context, ({ snapshot }) => snapshot("card"))).rejects.toThrow(/capacity|Capacity/);
    transports[0].release();
    transports[1].release();
    await waiting[1];
    // Actual operation settlement runs after the cancelled HTTP-facing wait.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result = await reader.read(context, ({ snapshot }) => snapshot("card"));
    expect(result.result[0].patient_count).toBe(6);
  } finally {
    for (const transport of transports) transport.release();
    await Promise.allSettled(waiting);
    await Promise.all(clients.map((client) => client.close()));
    for (const transport of transports) await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("coordinates actual API processes and keeps HTTP response ownership through disconnect and full encoding", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const transports = [await openTransport(), await openTransport()];
  let apps = [],
    waiting = [];
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const generation = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(generation, null);
    const actors = [],
      configs = [];
    const configure = (index) => (actor) =>
      new Promise((resolve) => {
        actors[index] = { id: `api-${index}`, ...actor, roles: ["api"] };
        configs[index] = resolve;
        if (actors.filter(Boolean).length !== 3) return;
        const shared = policy([cut], {
          processes: actors,
          overrides: { admission: { apiBytes: 128 * 1048576, builderBytes: 4 * 1048576 } },
        });
        for (const [i, done] of configs.entries()) done({ ...shared, processId: `api-${i}` });
      });
    apps = await Promise.all(
      [0, 1, 2].map((i) =>
        startApplication({
          db: fixture.db,
          activeGeneration: true,
          clock: SNAPSHOT_CLOCK,
          ...(i < 2 ? { transportUri: transports[i].uri } : {}),
          capacityFactory: configure(i),
        })
      )
    );
    const post = async (app, signal) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/card`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate: "2024-01-07",
          endDate: "2024-01-09",
          area: "",
          province: "",
          district: "",
          hcode: "",
        }),
      });
      return { status: response.status, body: await response.json(), source: response.headers.get("x-ncd-source-cut") };
    };
    const cancel = new AbortController();
    for (const i of [0, 1]) {
      const reached = transports[i].arm((command) => command.find === "patients_generations");
      const request = post(apps[i], i === 0 ? cancel.signal : undefined);
      void request.catch(() => {});
      waiting.push(request);
      await reached;
    }
    expect(await post(apps[2])).toEqual({
      status: 503,
      body: { status: false, message: "Read model unavailable" },
      source: null,
    });
    cancel.abort();
    await expect(waiting[0]).rejects.toThrow();
    expect((await post(apps[2])).status).toBe(503);
    transports[0].release();
    transports[1].release();
    expect((await waiting[1]).status).toBe(200);
    let complete;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      complete = await post(apps[2]);
      if (complete.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(complete).toMatchObject({ status: 200, source: SNAPSHOT_CLOCK, body: { result: [{ patient_count: 6 }] } });
  } finally {
    for (const transport of transports) transport.release();
    await Promise.allSettled(waiting);
    for (const app of apps) await app.close();
    for (const transport of transports) await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("records full finite raw, independent membership and differing-generation storage without relabeling retained samples as physical peaks", async () => {
  const fixture = await openFixture();
  const old = sealSnapshotFixture();
  const { rawDocuments } = await import("./raw-fixture.cjs");
  const records = rawDocuments().map((item) => ({
    ...item,
    claim_date: new Date(item.claim_date.getTime() + 6 * 86400000),
  }));
  records.push({
    ...records[3],
    _id: "one-additional-patient",
    cid: "p7",
    transaction_uid: "additional-service",
    diag_nosis: [{ diag: "I10" }],
  });
  const cut = sealSnapshotFixture(records);
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const first = await builder.build(old.sourceCut, FIXTURE_BUDGET, {
      ...old.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(first, null);
    expect(first.resources.ledger.raw).toMatchObject({
      records: 10,
      distinctPatientValues: 8,
      distinctHospitalValues: 2,
    });
    expect(first.resources.ledger.summary).toMatchObject({
      hospitalDays: 4,
      memberships: { DM: { expanded: 3, deduplicated: 3 } },
    });
    expect(first.resources.ledger.output).toMatchObject({
      dictionary: { patient: 6, hospital: 2 },
      memberships: { CARD: 7, HOSPITAL: 4 },
    });
    expect(first.resources.storage.coverage).toBe("retained-collection-samples-not-volume-peaks");
    const sourceStat = statSync(old.sourceCut.filename);
    expect(first.resources.ledger.transport.logicalBytes).toBe(sourceStat.size);
    expect(first.resources.ledger.transport.allocatedBytes).toBe(sourceStat.blocks * 512);
    expect(first.resources.ledger.transport.bytes).toBe(Math.max(sourceStat.size, sourceStat.blocks * 512));
    expect(first.resources.storage.retainedSourceBytes).toBeGreaterThanOrEqual(sourceStat.blocks * 512);
    expect(first.resources.storage.unavailable).toEqual(
      expect.arrayContaining([
        "database-transient-memory",
        "aggregation-index-spill-scratch",
        "journal-log-temp-volume-peaks",
      ])
    );
    const second = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    expect(second.resources.ledger.raw).toMatchObject({ records: 11, distinctPatientValues: 9 });
    expect(second.resources.ledger.output.dictionary.patient).toBe(7);
    const layouts = second.resources.storage.generations;
    const previousBytes = layouts.find((item) => item.generationId === first.generationId).logicalBsonBytes;
    const candidateBytes = layouts.find((item) => item.generationId === second.generationId).logicalBsonBytes;
    expect(candidateBytes).toBeGreaterThan(previousBytes);
    expect(
      second.resources.storage.collections.some((item) => item.name === "patients_model_control" && item.indexBytes > 0)
    ).toBe(true);
    await builder.publish(second, active);
    expect((await builder.cleanup(first.generationId)).removed).toEqual([first.generationId]);
    // Cleanup removes generation metadata, not producer-owned export files.
    // A separately trusted next policy must retain that known backing cost.
    const next = await createBuilder({
      db: fixture.db,
      capacity: policy([cut]),
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
    expect(next.resources.storage.sources.map((item) => item.backing)).toContain(
      first.resources.ledger.transport.backing
    );
    expect(next.resources.storage.retainedSourceBytes).toBeGreaterThanOrEqual(
      first.resources.ledger.transport.bytes + second.resources.ledger.transport.bytes
    );
  } finally {
    old.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("keeps previous process-wide observations attached to their actual Worker attempt on compatible recovery", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  let worker;
  try {
    const registration = startWorker(
      fileURLToPath(new URL("./recovery-worker.cjs", import.meta.url)),
      {
        uri: process.env.PATIENTS_TEST_MONGO_URI,
        database: fixture.db.databaseName,
        sourceCut: cut.sourceCut,
        context: { ...cut.comparisonContext, comparisonOnly: false },
        budget: FIXTURE_BUDGET,
        clock: SNAPSHOT_CLOCK,
      },
      { pauseAt: "B" }
    );
    worker = registration.worker;
    worker.postMessage("start");
    await registration.checkpoint;
    await worker.terminate();
    const result = await createBuilder({
      db: fixture.db,
      workers: [registration],
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false });
    expect(result.recovery.verifiedGroups).toEqual(["A", "B"]);
    expect(result.resources.observationHistory.length).toBeGreaterThan(0);
    const previous = result.resources.observationHistory[0];
    expect(previous.actor).toEqual(result.resources.observation.actor);
    expect(previous.attempt).not.toBe(result.resources.observation.attempt);
    expect(previous.attribution).toBe("whole-process-includes-workers-and-all-roles");
    expect(result.resources.peakRssBytes).toBe(result.resources.observation.peakRssBytes);
    expect(result.resources.peakAdditionalRssBytes).toBe(result.resources.observation.peakAdditionalRssBytes);
    expect(result.resources.historicalAdditionalRssMaximumBytes).toBeGreaterThanOrEqual(
      previous.peakAdditionalRssBytes
    );
    expect(result.resources.ledger.raw.records).toBe(10);
    expect(result.resources.ledger.summary.hospitalDays).toBe(4);
  } finally {
    await worker?.terminate();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("charges each response for its shared calculation before work starts while counting the physical shared owner once", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const generation = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(generation, null);
    const config = policy([cut], { overrides: { admission: { apiBytes: 80 * 1048576, builderBytes: 4 * 1048576 } } });
    const reader = createReader({ db: fixture.db, validationOnly: true, capacity: config });
    const context = {
      route: "patients-bar",
      backendMode: "candidate-validation",
      clock: new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    };
    expect((await reader.read(context, ({ snapshot }) => snapshot("card"))).result[0].patient_count).toBe(6);
    await expect(
      reader.read(context, ({ rangeFacts }) =>
        rangeFacts({ date: { $gte: new Date("2024-01-07"), $lte: new Date("2024-01-09") }, hcode: "H1" })
      )
    ).rejects.toThrow(/including shared work/);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it.each([
  ["cpu", { additional: 4.01, total: 4.01 }],
  ["disk", { additional: 858993460, total: 858993460 }],
  ["io:write", { additional: 500001, total: 500001 }],
  ["ram", { additional: 1073741825, total: 1073741825, api: 0, builder: 0, database: 1073741825 }],
])(
  "rejects a separately signed %s guard stimulus without presenting it as real target measurements",
  async (metric, value) => {
    const fixture = await openFixture();
    const cut = sealSnapshotFixture();
    try {
      const failed = await createBuilder({
        db: fixture.db,
        capacity: policy([cut], { observations: { [metric]: value } }),
      })
        .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
        .catch((error) => error);
      expect(failed).toBeInstanceOf(Error);
      expect(failed.message).toMatch(/Observed capacity/);
      expect(failed.resources.capacity).toMatchObject({
        acceptance: "failed",
        targetAcceptance: "blocked",
        reasons: expect.arrayContaining(["observer-peaks-not-representative", "capacity-guard-failed"]),
      });
    } finally {
      cut.close();
      await fixture.close();
    }
  },
  60000
);

it("keeps original capacity authority and fixed ceilings on compatible recovery and rejects a replacement policy", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  try {
    const original = policy([cut]);
    const builder = createBuilder({
      db: fixture.db,
      capacity: original,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
    });
    await fixture.db.createCollection("patients_identity", { validator: { $expr: { $eq: [1, 0] } } });
    const failed = await builder
      .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
      .catch((error) => error);
    expect(failed.code).toBe(121);
    await fixture.db.command({ collMod: "patients_identity", validator: {} });
    await expect(
      createBuilder({
        db: fixture.db,
        capacity: policy([cut], { overrides: { admission: { apiBytes: 4 * 1048576, builderBytes: 8 * 1048576 } } }),
      }).build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
    ).rejects.toThrow(/Recovery policy or fixed budget/);
    const recovered = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    expect(recovered.generationId).toBe(failed.generationId);
    expect(recovered.resources.capacity.policyKey).toBe(failed.resources.capacity.policyKey);
    expect(recovered.resources.declared).toEqual(FIXTURE_BUDGET);
    const prior = recovered.resources.observationHistory.find(
      (item) => item.attempt === failed.resources.observation.attempt
    );
    expect(prior.samples).toBeGreaterThanOrEqual(failed.resources.observation.samples);
    expect(recovered.resources.failureHistory[0]).toMatchObject({ name: "MongoServerError", code: 121 });
    expect(recovered.recovery.verifiedGroups).toEqual(["A", "B"]);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("bounds a pending trusted collector by the original build deadline and keeps its uncertain ownership protected", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  let release, reached, pending;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const began = new Promise((resolve) => {
    reached = resolve;
  });
  const config = policy([cut], { observations: {} });
  const collect = config.observe;
  config.observe = async (request) => {
    reached();
    await held;
    return collect(request);
  };
  const builder = createBuilder({ db: fixture.db, capacity: config });
  let timer;
  try {
    pending = builder
      .build(cut.sourceCut, { ...FIXTURE_BUDGET, maxTimeMS: 1000 }, { ...cut.comparisonContext, comparisonOnly: false })
      .catch((error) => error);
    await Promise.race([
      began,
      pending.then(() => {
        throw new Error("Collector did not start before the original deadline");
      }),
    ]);
    const failed = await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("collector-still-pending"), 1800);
      }),
    ]);
    expect(failed).toBeInstanceOf(Error);
    expect(failed.message).toMatch(/observation deadline/);
    expect(failed.resources.capacity.reasons).toContain("observation-termination-unverified");
    await expect(builder.cleanup(failed.generationId)).rejects.toThrow(/owned|blocked/);
  } finally {
    clearTimeout(timer);
    release();
    await pending;
    cut.close();
    await fixture.close();
  }
}, 60000);

it("preserves the primary stage error and blocks resume when the failed attempt observations cannot be persisted", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  const builder = createBuilder({ db: fixture.db, capacity: policy([cut]) });
  try {
    await fixture.db.createCollection("patients_identity", { validator: { $expr: { $eq: [1, 0] } } });
    await fixture.db.createCollection("patients_recovery_journal", {
      validator: { "resources.failureHistory.0": { $exists: false } },
    });
    const failed = await builder
      .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
      .catch((error) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed.code).toBe(121);
    expect(failed.resources.failureRecordPersistence).toBe("unverified");
    await fixture.db.command({ collMod: "patients_identity", validator: {} });
    await fixture.db.command({ collMod: "patients_recovery_journal", validator: {} });
    await expect(
      builder.build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
    ).rejects.toThrow(/owned|fenced|observations/);
    await expect(builder.cleanup(failed.generationId)).rejects.toThrow(/owned|blocked/);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("honors the original Builder RAM ceiling when a trusted role observation is below the larger derived policy cap", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  try {
    const failed = await createBuilder({
      db: fixture.db,
      capacity: policy([cut], {
        observations: {
          ram: { additional: 200 * 1048576, total: 200 * 1048576, api: 0, builder: 200 * 1048576, database: 0 },
        },
      }),
    })
      .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
      .catch((error) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed.message).toMatch(/Observed capacity role RAM/);
    expect(failed.resources.capacity.fixedLimits[0].builderBytes).toBe(512 * 1048576);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects a signed isolated-response peak above 128 MiB even when aggregate API RAM remains below 256 MiB", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  try {
    const failed = await createBuilder({
      db: fixture.db,
      capacity: policy([cut], {
        observations: {
          ram: {
            additional: 200 * 1048576,
            total: 200 * 1048576,
            api: 200 * 1048576,
            builder: 0,
            database: 0,
            response: {
              additional: 200 * 1048576,
              unit: "bytes",
              attribution: "isolated-response-additional-peak",
              coverage: "complete-peak",
              evidence: "synthetic-response-guard-not-target-measurement",
            },
          },
        },
      }),
    })
      .build(cut.sourceCut, FIXTURE_BUDGET, { ...cut.comparisonContext, comparisonOnly: false })
      .catch((error) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed.message).toMatch(/Observed capacity response RAM/);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);
