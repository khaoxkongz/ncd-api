import { expect, it } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openFixture } from "./contract.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } from "./snapshot-fixture.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";
import { policy } from "./capacity-fixture.cjs";
import { ACTOR } from "../../src/modules/patients/read-model/capacity.js";
import { BSON } from "mongodb";
import { fixtureRelease, descriptor, reviewedEvidence, page, apiCapacity, TARGET_GATES } from "./release-fixture.cjs";
import { openTransport } from "./mongo-transport.cjs";
import { rawDocuments } from "./raw-fixture.cjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
it("captures one backend at actual startup, keeps legacy independent, and rejects missing release evidence on all six routes", async () => {
  const fixture = await openFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-release-startup-"));
  const uri = new URL(process.env.PATIENTS_TEST_MONGO_URI);
  uri.pathname = `/${fixture.db.databaseName}`;
  const program = `
    const Module = require("node:module");
    const load = Module._load;
    Module._load = function(request, ...rest) {
      if (request === "roaring" || request.endsWith("/read-model/source")) throw new Error("Optimized dependency unavailable");
      return load.call(this, request, ...rest);
    };
    void (async () => {
      const backend = require(${JSON.stringify(path.join(ROOT, "src/modules/patients/backend.js"))});
      await backend.initializePatientsBackend({ mode: "legacy" });
      process.env.NCD_PATIENTS_BACKEND = "read-model";
      const app = require(${JSON.stringify(path.join(ROOT, "src/app.js"))});
      const server = app.listen(0, "127.0.0.1");
      await require("node:events").once(server, "listening");
      try {
        const page = async () => Promise.all(["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"].map(async route => {
          const response = await fetch("http://127.0.0.1:" + server.address().port + "/ncds_api/api/v1/" + route, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: "2024-01-01", endDate: "2026-10-13", backend: "legacy" }),
          });
          return { status: response.status, body: await response.json() };
        }));
        const legacy = await page();
        const report = await backend.initializePatientsBackend({ mode: "read-model" });
        const unavailable = await page();
        process.stdout.write("RELEASE_RESULT=" + JSON.stringify({ legacy: legacy.map(x => [x.status,x.body.status,x.body.message]), unavailable, report }) + "\\n");
      } finally {
        await new Promise(resolve => server.close(resolve));
        await require(${JSON.stringify(path.join(ROOT, "src/lib/mongo.js"))}).db.client.close();
      }
    })().catch(error => { process.stderr.write(error.stack + "\\n"); process.exitCode = 1; });
  `;
  try {
    const output = execFileSync(process.execPath, ["-e", program], {
      cwd: directory,
      timeout: 25000,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NCD_PATIENTS_BACKEND: "legacy",
        MONGO_URI: uri.toString(),
        DISCORD_BOT_TOKEN: "unused-fixture",
        DISCORD_CHANNEL_ID_SUCCESS: "unused-fixture",
        DISCORD_CHANNEL_ID_PROGRESS: "unused-fixture",
        DISCORD_CHANNEL_ID_ERROR: "unused-fixture",
        CID_HASH_SECRET_KEY: "unused-fixture",
      },
    });
    const result = JSON.parse(
      output
        .split("\n")
        .find((line) => line.startsWith("RELEASE_RESULT="))
        .slice(15)
    );
    expect(result.legacy).toEqual(Array.from({ length: 6 }, () => [200, true, "success"]));
    expect(result.unavailable).toEqual(
      Array.from({ length: 6 }, () => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
    );
    expect(result.report.activation).toBe("blocked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    await fixture.close();
  }
}, 30000);

it("serves all six full pinned results only through independently reviewed fixture authority while target gates remain unmet", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actor) => ({
        ...policy([cut], {
          processes: [
            { id: "builder", ...ACTOR, roles: ["builder", "api"] },
            { id: "api", ...actor, roles: ["api"] },
          ],
        }),
        processId: "api",
      }),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(candidate)]),
    });
    const load = await app.captureLoad({ bodyBytes: JSON.stringify(SNAPSHOT_REQUEST) });
    expect(load.settlement.safe).toBe(true);
    expect(load.errorEvidenceVerified).toBe(true);
    expect(load.telemetry.requests.every((request) => request.capacity?.generationId === candidate.generationId)).toBe(
      true
    );
    const responses = await page(app);
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));
    expect(responses[0].body.result).toEqual([
      { service_count: 9, patient_count: 6, expense: 370, hcode_count: 2, avg_service: 1.5, avg_expense: 61.67 },
    ]);
    expect(responses.every((response) => response.source === SNAPSHOT_CLOCK && response.state === "fresh")).toBe(true);
    expect(app.release.activation).toBe("fixture-exercise");
    expect(app.release.targetActivation).toBe("blocked");
    expect(app.release.gates.map((gate) => gate.name)).toEqual(TARGET_GATES);
    await fixture.db
      .collection("patients_generations")
      .updateOne({ _id: candidate.generationId }, { $set: { seal: "0".repeat(64) } });
    expect((await page(app)).every((response) => response.status === 503 && response.body.result === undefined)).toBe(
      true
    );
    await fixture.db
      .collection("patients_generations")
      .updateOne({ _id: candidate.generationId }, { $set: { seal: candidate.seal } });
    expect(await page(app)).toEqual(responses);
  } finally {
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("loads independently installed release and capacity files through actual bootstrap and keeps their exact policy on all six responses", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-installed-release-"));
  let app, actor, expectedKey;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actual) => {
        actor = actual;
        return apiCapacity([cut], actual);
      },
      releaseFactory: (subject) => {
        const installedCapacity = apiCapacity([cut], actor);
        const release = reviewedEvidence(subject, [descriptor(candidate)], installedCapacity);
        expectedKey = BSON.deserialize(release.evidence.manifest).gates.capacity.observations.policyKey;
        fs.writeFileSync(path.join(directory, "release.bson"), release.evidence.manifest);
        fs.writeFileSync(path.join(directory, "release.sig"), release.evidence.signature);
        fs.writeFileSync(path.join(directory, "capacity.bson"), installedCapacity.evidence.manifest);
        fs.writeFileSync(path.join(directory, "capacity.sig"), installedCapacity.evidence.signature);
        const installed = {
          policy: release.policy,
          evidence: { manifestFile: "release.bson", signatureFile: "release.sig" },
          capacity: {
            binding: installedCapacity.binding,
            processId: "api",
            trustedOperators: Object.fromEntries(
              Object.entries(installedCapacity.trustedOperators).map(([id, entry]) => [
                id,
                { ...entry, publicKey: entry.publicKey.export({ type: "spki", format: "pem" }) },
              ])
            ),
            evidence: { manifestFile: "capacity.bson", signatureFile: "capacity.sig" },
          },
        };
        const configFile = path.join(directory, "installed.json");
        fs.writeFileSync(configFile, JSON.stringify(installed));
        return { configFile };
      },
    });
    expect(app.release.reason).toBe("fixture-protocol-only");
    const load = await app.captureLoad({ bodyBytes: JSON.stringify(SNAPSHOT_REQUEST) });
    expect(load.responses.map((response) => response.status)).toEqual(Array(6).fill(200));
    expect(load.settlement.safe).toBe(true);
    expect(load.telemetry.requests.every((request) => request.capacity.policyKey === expectedKey)).toBe(true);
  } finally {
    await app?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects unapproved publication, prepares the new exact identity, and rolls back only retained compatible output", async () => {
  const fixture = await openFixture(),
    first = sealSnapshotFixture(),
    transport = await openTransport();
  const rows = rawDocuments().map((row) => ({ ...row, claim_date: new Date(row.claim_date.getTime() + 6 * 86400000) }));
  rows.push({
    ...rows[0],
    _id: "release-corrected-row",
    cid: "release-new-patient",
    transaction_uid: "release-new-service",
  });
  const second = sealSnapshotFixture(rows, {
    manifestOverrides: { sourceVersion: "release-corrected-v2", sourceCutAt: "2024-01-09T06:00:00.000Z" },
  });
  let app, held, capacity;
  try {
    let builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const old = await builder.build(first.sourceCut, FIXTURE_BUDGET, {
      ...first.comparisonContext,
      comparisonOnly: false,
    });
    const activeA = await builder.publish(old, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      transportUri: transport.uri,
      capacityFactory: (actor) => (capacity = apiCapacity([first, second], actor)),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(old)]),
    });
    builder = createBuilder({
      db: fixture.db,
      clock: () => new Date(SNAPSHOT_CLOCK),
      timeZone: "UTC",
      capacity: { ...capacity, processId: "builder" },
    });
    const original = await page(app);
    const subject = app.release.subject;
    const reached = transport.arm((command) => command.find === "patients_snapshots");
    held = fetch(`${app.url}/ncds_api/api/v1/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SNAPSHOT_REQUEST),
    });
    await reached;
    const candidate = await builder.build(second.sourceCut, FIXTURE_BUDGET, {
      ...second.comparisonContext,
      comparisonOnly: false,
    });
    const activeB = await builder.publish(candidate, activeA);
    expect((await page(app)).map((response) => [response.status, response.body])).toEqual(
      Array.from({ length: 6 }, () => [503, { status: false, message: "Read model unavailable" }])
    );
    await expect(builder.cleanup(old.generationId)).rejects.toThrow(/owned|blocked/);
    transport.release();
    const pinned = await held;
    expect((await pinned.json()).result[0].patient_count).toBe(6);
    expect(pinned.headers.get("x-ncd-source-cut")).toBe(SNAPSHOT_CLOCK);
    await app.applyRelease({
      mode: "read-model",
      release: fixtureRelease(subject, [descriptor(candidate, [activeB.publicationVersion])]),
    });
    const corrected = await page(app);
    expect(corrected[0].body.result[0].patient_count).toBe(7);
    expect(corrected.every((response) => response.source === "2024-01-09T06:00:00.000Z")).toBe(true);
    await app.rollbackRelease({
      target: old.generationId,
      expectedActive: activeB,
      release: fixtureRelease(subject, [descriptor(old, ["3"])]),
    });
    expect(await page(app)).toEqual(original);
    expect(await builder.cleanup(candidate.generationId)).toEqual({ removed: [candidate.generationId] });
    await expect(
      app.rollbackRelease({
        target: candidate.generationId,
        expectedActive: { generationId: old.generationId, publicationVersion: "3" },
        release: fixtureRelease(subject, [descriptor(candidate, ["4"])]),
      })
    ).rejects.toThrow();
    expect(await page(app)).toEqual(original);
  } finally {
    transport.release();
    await Promise.allSettled([held]);
    await app?.close();
    await transport.close();
    first.close();
    second.close();
    await fixture.close();
  }
}, 90000);

it("applies the installed validity window to new reads while permitting a pinned response and preserving stale source time", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture(),
    transport = await openTransport();
  let app, held;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: "2026-10-16T00:00:00.000Z",
      backendMode: "read-model",
      transportUri: transport.uri,
      capacityFactory: (actor) => apiCapacity([cut], actor),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(candidate)]),
    });
    const subject = app.release.subject;
    const installed = fixtureRelease(subject, [descriptor(candidate)], {
      policyChange: (value) => ({
        ...value,
        validity: { kind: "window", from: Date.now() - 1000, until: Date.now() + 2500, inFlight: "pinned-completion" },
      }),
    });
    expect((await app.applyRelease({ mode: "read-model", release: installed })).activation).toBe("fixture-exercise");
    const request = { startDate: "2024-01-07", endDate: "2024-01-09", area: "", province: "", district: "", hcode: "" };
    const stale = await page(app, request);
    expect(
      stale.every(
        (response) => response.status === 200 && response.source === SNAPSHOT_CLOCK && response.state === "stale"
      )
    ).toBe(true);
    const reached = transport.arm((command) => command.find === "patients_snapshots");
    held = fetch(`${app.url}/ncds_api/api/v1/graph-dm-pt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    await reached;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, installed.policy.validity.until - Date.now() + 10)));
    expect(
      (await page(app, request)).every((response) => response.status === 503 && response.body.result === undefined)
    ).toBe(true);
    transport.release();
    const pinned = await held;
    expect(pinned.status).toBe(200);
    expect(pinned.headers.get("x-ncd-source-cut")).toBe(SNAPSHOT_CLOCK);
    expect(pinned.headers.get("x-ncd-data-state")).toBe("stale");
    await pinned.json();
  } finally {
    transport.release();
    await Promise.allSettled([held]);
    await app?.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects reviewed missing, mismatched, revoked, expired and overrun gate observations rather than accepting approval flags", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  let app, capacity;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actor) => (capacity = apiCapacity([cut], actor)),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(candidate)]),
    });
    const subject = app.release.subject;
    const cases = [
      [
        "original-lower-builder-cap",
        (draft) => {
          draft.gates.capacity.observations.fixedBudgets.builderBytes = 512 * 1048576;
          draft.gates.capacity.observations.domains[0].ram.builder = 200 * 1048576;
          draft.gates.capacity.observations.domains[0].ram.combined = 200 * 1048576 + 6;
          draft.gates.capacity.observations.domains[0].ram.total = 200 * 1048576 + 6;
        },
      ],
      ...TARGET_GATES.map((name) => [
        `missing-${name}`,
        (draft) => {
          delete draft.gates[name];
        },
      ]),
      [
        "full-matrix",
        (draft) => {
          draft.gates["full-workload"].observations.coverage.pop();
        },
      ],
      [
        "wrong-source",
        (draft) => {
          draft.gates.source.observations.sources[0].sha256 = "f".repeat(64);
        },
      ],
      [
        "wrong-rendered-body",
        (draft) => {
          draft.gates.page.observations.conditions[0].attempts[0].responses[0].bodySha256 = "f".repeat(64);
          draft.gates.page.observations.conditions[0].attempts.slice(1, 6).forEach((attempt) => (attempt.errors = 1));
        },
      ],
      [
        "page-denominator",
        (draft) => {
          draft.gates.page.observations.conditions[0].attempts.pop();
        },
      ],
      [
        "page-failures",
        (draft) => {
          draft.gates.page.observations.conditions[0].attempts.slice(0, 6).forEach((attempt) => (attempt.errors = 1));
        },
      ],
      [
        "freshness-overrun",
        (draft) => {
          draft.gates.freshness.observations.recoveryMS = 4 * 3600000;
        },
      ],
      [
        "capacity-unknown",
        (draft) => {
          draft.gates.capacity.unverified.push("database-complete-peak");
        },
      ],
      [
        "wrong-native",
        (draft) => {
          draft.gates.native.observations.runtime.arch = "unreviewed-arch";
        },
      ],
      [
        "wrong-frontend",
        (draft) => {
          draft.gates.frontend.observations.revision = "unreviewed-frontend";
        },
      ],
    ];
    for (const [name, mutate] of cases) {
      const release = reviewedEvidence(subject, [descriptor(candidate)], capacity, (draft) => {
        mutate(draft);
        return draft;
      });
      const result = await app.applyRelease({ mode: "read-model", release });
      expect(result.activation, name).toBe("blocked");
      expect(
        (await page(app)).map((response) => [response.status, response.body]),
        name
      ).toEqual(Array.from({ length: 6 }, () => [503, { status: false, message: "Read model unavailable" }]));
    }
    const untrusted = [
      (release) => {
        delete release.policy.revision;
        delete release.policy.validity.revision;
      },
      (release) => {
        release.policy.reviewer.role = "source-producer";
      },
      (release) => {
        release.policy.reviewedSha256 = "f".repeat(64);
      },
      (release) => {
        release.policy.validity = {
          kind: "window",
          from: Date.now() - 2000,
          until: Date.now() - 1000,
          inFlight: "pinned-completion",
        };
      },
      (release) => {
        release.policy.revocations = [release.policy.reviewedSha256];
      },
      (release) => {
        release.policy.scope = "deployment";
      },
      (release) => {
        release.evidence.signature = Buffer.alloc(64);
      },
      (release) => {
        release.evidence.manifest = Buffer.alloc(512 * 1024 + 1);
      },
      (release) => {
        release.policy = { passed: true };
      },
    ];
    for (const mutate of untrusted) {
      const release = fixtureRelease(subject, [descriptor(candidate)]);
      mutate(release);
      expect((await app.applyRelease({ mode: "read-model", release })).activation).toBe("blocked");
      expect((await page(app)).every((response) => response.status === 503)).toBe(true);
    }
  } finally {
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 90000);

it("changes the single selector to legacy while an actual pinned optimized response finishes from its original runtime", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture(),
    transport = await openTransport();
  let app, held;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      transportUri: transport.uri,
      capacityFactory: (actor) => apiCapacity([cut], actor),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(candidate)]),
    });
    const reached = transport.arm((command) => command.find === "patients_snapshots");
    held = fetch(`${app.url}/ncds_api/api/v1/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SNAPSHOT_REQUEST),
    });
    await reached;
    await app.applyRelease({ mode: "legacy" });
    const legacy = await page(app, { startDate: "2024-01-07", endDate: "2024-01-08" });
    expect(legacy.map((response) => [response.status, response.source, response.state])).toEqual(
      Array.from({ length: 6 }, () => [200, null, "unknown"])
    );
    expect(legacy[0].body.result).toEqual([
      { service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 },
    ]);
    transport.release();
    const old = await held;
    expect((await old.json()).result[0].patient_count).toBe(6);
    expect(old.headers.get("x-ncd-source-cut")).toBe(SNAPSHOT_CLOCK);
  } finally {
    transport.release();
    await Promise.allSettled([held]);
    await app?.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("consumes concrete deployment gate schemas through fixture startup without promoting synthetic observations to target approval", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  let app, capacity;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actor) =>
        (capacity = {
          ...policy([cut], {
            processes: [
              { id: "builder", ...ACTOR, roles: ["builder", "api"] },
              { id: "api", ...actor, roles: ["api"] },
            ],
          }),
          processId: "api",
        }),
      releaseFactory: (subject) => reviewedEvidence(subject, [descriptor(candidate)], capacity),
    });
    expect(app.release.reason).toBe("fixture-protocol-only");
    expect((await page(app)).map((response) => response.status)).toEqual(Array(6).fill(200));
    expect(app.release.activation).toBe("fixture-exercise");
    expect(app.release.targetActivation).toBe("blocked");
    expect(app.release.gates.every((gate) => gate.state === "schema-exercised-only")).toBe(true);
  } finally {
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);
