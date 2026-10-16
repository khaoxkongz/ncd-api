import { expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { startApplication } from "./application.cjs";
import { PARTS } from "./contract-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { seedBaseline } from "./refresh-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createHash } from "node:crypto";
import { openTransport } from "./mongo-transport.cjs";
import { COLLECTIONS } from "../../src/modules/patients/read-model/schema.js";
import { referencePage } from "./load-fixture.cjs";
import { summarizeAttempts } from "./compare.cjs";

it("rejects a real application exit during startup and observes its termination within the startup bound", async () => {
  const fixture = await openFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-load-startup-"));
  fs.writeFileSync(path.join(directory, "app.js"), "process.exit(23);\n");
  try {
    const outcome = await Promise.race([
      startApplication({ db: fixture.db, sourceRoot: directory, startupTimeoutMS: 300 }).then(
        () => ({ unexpected: "ready" }),
        (error) => ({ message: error.message, exited: error.teardown?.exited })
      ),
      new Promise((resolve) => setTimeout(() => resolve({ unexpected: "pending" }), 700)),
    ]);
    expect(outcome).toEqual({ message: "Fixture app exited before ready", exited: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    await fixture.close();
  }
}, 10000);

it("captures all six real controllers through parsed bodies and genuine dependency settlement against a stable independent baseline", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const baseline = archiveBaseline();
  const bytes = '{"startDate":"2024-01-07","endDate":"2024-01-08T23:59:59.999Z"}';
  let legacy, app;
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: SNAPSHOT_CLOCK });
    const { BSON } = await import("mongodb");
    const file = fs.readFileSync(cut.sourceCut.filename);
    const rows = [];
    for (let offset = 0; offset < file.length;) {
      const size = file.readInt32LE(offset);
      rows.push(BSON.deserialize(file.subarray(offset, offset + size)));
      offset += size;
    }
    await seedBaseline(fixture.db, baseline, rows, legacy);
    const capture = () =>
      Promise.all(
        PARTS.map(async ({ route }) => {
          const response = await fetch(`${legacy.url}/ncds_api/api/v1/${route}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: bytes,
          });
          return { route, status: response.status, body: await response.json() };
        })
      );
    const reference = await capture();
    expect(await capture()).toEqual(reference);
    await legacy.close();
    legacy = null;
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    expect(app.runtime).toMatchObject({ clock: SNAPSHOT_CLOCK, timeZone: "UTC", mongo: fixture.version });
    expect(Object.values(app.productSources)).toEqual(Array(4).fill(expect.stringMatching(/^[a-f0-9]{64}$/)));
    const result = await app.captureLoad({ bodyBytes: bytes, origin: "https://fixture.invalid" });
    expect(result.responses.map(({ route, status, body }) => ({ route, status, body }))).toEqual(reference);
    expect(result).toMatchObject({
      complete: true,
      errorEvidenceVerified: true,
      queryErrors: [],
      settlement: { safe: true },
    });
    expect(result.telemetry.commandsStarted).toBeGreaterThan(0);
    expect(result.telemetry.commandsStarted).toBe(result.telemetry.commandsSettled);
    expect(
      result.responses.every(
        ({ parsedBodyMS, headers }) =>
          parsedBodyMS >= 0 &&
          headers["cache-control"] === "no-store" &&
          headers["x-ncd-source-cut"] === SNAPSHOT_CLOCK &&
          headers["x-ncd-data-state"] === "fresh" &&
          headers["access-control-allow-origin"] === "*"
      )
    ).toBe(true);
    expect(result.combinedParsedBodiesMS).toBeGreaterThanOrEqual(
      Math.max(...result.responses.map(({ parsedBodyMS }) => parsedBodyMS))
    );
    await app.close();
    app = null;
    const { runLoads } = await import("./loads.cjs");
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-ncd-source-cut": SNAPSHOT_CLOCK,
      "x-ncd-data-state": "fresh",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "X-NCD-Source-Cut, X-NCD-Data-State",
    };
    const report = await runLoads(
      {
        scope: "isolated-fixture",
        phase: "explore",
        clock: SNAPSHOT_CLOCK,
        timeZone: "UTC",
        source: BSON.deserialize(cut.sourceCut.manifest),
        generation: { id: candidate.generationId, versions: candidate.versions },
        reference: {
          baselineRevision: baselineRevision(),
          repeated: "exactly equal",
          sha256: createHash("sha256").update(JSON.stringify(reference)).digest("hex"),
        },
        conditions: ["later", "first"].map((trial) => ({
          id: `two-day-live-${trial}`,
          scenario: "finite-two-day-live",
          trial,
          routing: "live",
          requestBytes: bytes,
          reference: reference.map((response) => ({ ...response, headers })),
        })),
      },
      { openApplication: () => startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK }) }
    );
    expect(report.conditions[0]).toMatchObject({
      attempted: 20,
      requiredAttempts: 20,
      warmups: { required: 5, attempted: 5, excluded: 5, valid: true },
      apiProtocolPassed: true,
      summary: { p95Rank: 19, failed: 0 },
    });
    expect(report.attempts).toHaveLength(45);
    expect(report.attempts.filter(({ excluded }) => excluded)).toHaveLength(5);
    expect(report.conditions[1]).toMatchObject({
      sessions: 20,
      attempted: 20,
      apiProtocolPassed: true,
      warmups: { required: 0, attempted: 0, excluded: 0, valid: true },
    });
    expect(report.conditions[1].sessionActors).toHaveLength(20);
    expect(new Set(report.conditions[1].sessionActors.map(({ pid, startedAt }) => `${pid}:${startedAt}`)).size).toBe(
      20
    );
    expect(report.releaseGates).toMatchObject({
      page: "failed",
      visibleFreshness: "failed",
      targetCapacity: "blocked",
      fullMatrix: "failed",
      production: "not-accepted",
    });
    const acceptance = await runLoads(
      {
        scope: "isolated-fixture",
        phase: "acceptance",
        clock: SNAPSHOT_CLOCK,
        timeZone: "UTC",
        source: BSON.deserialize(cut.sourceCut.manifest),
        generation: { id: candidate.generationId, versions: candidate.versions },
        reference: {
          baselineRevision: baselineRevision(),
          repeated: "exactly equal",
          sha256: createHash("sha256").update(JSON.stringify(reference)).digest("hex"),
        },
        conditions: [
          {
            id: "two-day-live-acceptance-later",
            scenario: "finite-two-day-live",
            trial: "later",
            routing: "live",
            requestBytes: bytes,
            reference: reference.map((response) => ({ ...response, headers })),
          },
        ],
      },
      { openApplication: () => startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK }) }
    );
    expect(acceptance.conditions[0]).toMatchObject({
      attempted: 100,
      requiredAttempts: 100,
      apiProtocolPassed: true,
      summary: { p95Rank: 95, failed: 0 },
      warmups: { attempted: 5, excluded: 5 },
    });
    expect(acceptance.attempts).toHaveLength(105);
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "patients-load-partial-"));
    const failing = fs.mkdtempSync(path.join(os.tmpdir(), "patients-load-exit-"));
    fs.writeFileSync(path.join(failing, "app.js"), "process.exit(23);\n");
    try {
      const partial = await runLoads(
        {
          scope: "isolated-fixture",
          phase: "explore",
          clock: SNAPSHOT_CLOCK,
          timeZone: "UTC",
          source: BSON.deserialize(cut.sourceCut.manifest),
          generation: { id: candidate.generationId, versions: candidate.versions },
          reference: {
            baselineRevision: baselineRevision(),
            repeated: "exactly equal",
            sha256: createHash("sha256").update(JSON.stringify(reference)).digest("hex"),
          },
          conditions: [
            {
              id: "real-startup-failure",
              scenario: "finite-two-day-live",
              trial: "first",
              routing: "live",
              requestBytes: bytes,
              reference: reference.map((response) => ({ ...response, headers })),
            },
          ],
        },
        {
          openApplication: () => startApplication({ db: fixture.db, sourceRoot: failing }),
          outputDirectory: path.join(output, "report"),
        }
      );
      expect(partial).toMatchObject({
        completion: "partial-failed",
        conditions: [{ attempted: 1, unexecuted: 19, summary: { failed: 1, p95Ms: "Infinity" } }],
      });
      const events = fs
        .readFileSync(path.join(output, "report/attempts.ndjson"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.map(({ event }) => event)).toEqual(["attempt-started", "attempt-completed"]);
      expect(events[1].responses).toHaveLength(6);
      expect(
        JSON.parse(fs.readFileSync(path.join(output, "report/report.json"), "utf8")).conditions[0].summary.samples[0]
          .effectiveDurationMs
      ).toBe("Infinity");
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
      fs.rmSync(failing, { recursive: true, force: true });
    }
  } finally {
    await app?.close();
    await legacy?.close();
    cut.close();
    baseline.close();
    await fixture.close();
  }
}, 90000);

it("retains real Mongo server errors and exact negative responses separately from successful page timings", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const baseline = archiveBaseline();
  let app,
    legacy,
    renamed = false,
    view = false;
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: SNAPSHOT_CLOCK });
    const { BSON } = await import("mongodb");
    const file = fs.readFileSync(cut.sourceCut.filename),
      rows = [];
    for (let offset = 0; offset < file.length;) {
      const size = file.readInt32LE(offset);
      rows.push(BSON.deserialize(file.subarray(offset, offset + size)));
      offset += size;
    }
    await seedBaseline(fixture.db, baseline, rows, legacy);
    const bodyBytes = '{"startDate":"2024-01-07","endDate":"2024-01-08T23:59:59.999Z"}';
    const independent = await referencePage(legacy, bodyBytes);
    expect(await referencePage(legacy, bodyBytes)).toEqual(independent);
    await legacy.close();
    legacy = null;
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    const positive = await app.captureLoad({ bodyBytes });
    expect(positive.complete).toBe(true);
    await fixture.db.collection(COLLECTIONS.daily).rename("fixture_load_saved_daily");
    renamed = true;
    await fixture.db.createCollection(COLLECTIONS.daily, {
      viewOn: "fixture_load_saved_daily",
      pipeline: [{ $match: { $expr: { $eq: [{ $divide: [1, 0] }, 1] } } }],
    });
    view = true;
    const negative = await app.captureLoad({ bodyBytes });
    expect(negative).toMatchObject({ complete: true, errorEvidenceVerified: true, settlement: { safe: true } });
    expect(negative.responses.slice(0, 3).map(({ status, body }) => ({ status, body }))).toEqual(
      Array.from({ length: 3 }, () => ({ status: 503, body: { status: false, message: "Read model unavailable" } }))
    );
    expect(negative.responses.slice(3).map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(
      negative.queryErrors.some(
        ({ name, code, kind }) => name === "MongoServerError" && code === 2 && kind === "commandFailed"
      )
    ).toBe(true);
    expect(JSON.stringify(negative.telemetry)).not.toMatch(
      /divide|fixture_load_saved_daily|127\.0\.0\.1|patients_contract_|errmsg|pipeline/
    );
    await app.close();
    app = null;
    const { runLoads } = await import("./loads.cjs");
    const reference = independent.map(({ route, status, body }, index) => ({
      route,
      status: index < 3 ? 503 : status,
      body: index < 3 ? { status: false, message: "Read model unavailable" } : body,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-ncd-source-cut": index < 3 ? null : SNAPSHOT_CLOCK,
        "x-ncd-data-state": index < 3 ? "unknown" : "fresh",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "X-NCD-Source-Cut, X-NCD-Data-State",
      },
    }));
    const report = await runLoads(
      {
        scope: "isolated-fixture",
        phase: "explore",
        clock: SNAPSHOT_CLOCK,
        timeZone: "UTC",
        source: BSON.deserialize(cut.sourceCut.manifest),
        generation: { id: candidate.generationId, versions: candidate.versions },
        reference: {
          baselineRevision: baselineRevision(),
          repeated: "exactly equal",
          sha256: createHash("sha256").update(JSON.stringify(reference)).digest("hex"),
        },
        conditions: [
          {
            id: "actual-mongo-error",
            scenario: "actual-mongo-error",
            trial: "later",
            routing: "live",
            negative: true,
            requestBytes: bodyBytes,
            reference,
          },
        ],
      },
      { openApplication: () => startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK }) }
    );
    expect(report.conditions[0]).toMatchObject({
      attempted: 20,
      negativeComparisons: { attempted: 20, matched: 20, passed: true },
      apiProtocolPassed: false,
      summary: { failed: 20, correctComplete: 0, p95Ms: "Infinity" },
    });
    await fixture.db.collection(COLLECTIONS.daily).drop();
    view = false;
    await fixture.db.collection("fixture_load_saved_daily").rename(COLLECTIONS.daily);
    renamed = false;
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    expect((await app.captureLoad({ bodyBytes })).responses.map(({ status, body }) => ({ status, body }))).toEqual(
      positive.responses.map(({ status, body }) => ({ status, body }))
    );
  } finally {
    await app?.close();
    await legacy?.close();
    if (view) await fixture.db.collection(COLLECTIONS.daily).drop();
    if (renamed) await fixture.db.collection("fixture_load_saved_daily").rename(COLLECTIONS.daily);
    cut.close();
    baseline.close();
    await fixture.close();
  }
}, 60000);

function baselineRevision() {
  return "0a1934df24b1b66a2edbe2cb3e8235a7073932a7";
}

it("uses ranks 19 and 95 with every failure and unverified query outcome retained at infinity", () => {
  const success = { correct: true, complete: true, errorEvidenceVerified: true, queryErrors: [], durationMs: 15000 };
  for (const [requiredAttempts, successes, passed] of [
    [20, 19, true],
    [20, 18, false],
    [100, 95, true],
    [100, 94, false],
  ]) {
    const attempts = Array.from({ length: requiredAttempts }, (_, index) =>
      index < successes ? success : { ...success, errorEvidenceVerified: false }
    );
    const summary = summarizeAttempts(attempts, { requiredAttempts });
    expect(summary).toMatchObject({
      attempted: requiredAttempts,
      correctComplete: successes,
      failed: requiredAttempts - successes,
      p95Rank: requiredAttempts === 20 ? 19 : 95,
      timingPassed: passed,
      p95Ms: passed ? 15000 : "Infinity",
    });
    expect(
      summary.samples.slice(successes).every(({ effectiveDurationMs }) => effectiveDurationMs === "Infinity")
    ).toBe(true);
  }
});

it("retains a cancelled caller's shared work until the other five routes and actual shared finalization settle", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture();
  const transport = await openTransport();
  let app, pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const first = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(first, null);
    const second = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: SNAPSHOT_CLOCK,
      transportUri: transport.uri,
    });
    const held = transport.arm((command) => command.aggregate === COLLECTIONS.daily);
    const cancelled = new AbortController();
    const bodyBytes = '{"startDate":"2024-01-07","endDate":"2024-01-08T23:59:59.999Z"}';
    pending = app.captureLoad({ bodyBytes, signals: { card: cancelled.signal }, drainTimeoutMS: 3000 });
    await held;
    await builder.publish(second, active);
    cancelled.abort();
    await expect(app.captureLoad({ bodyBytes })).rejects.toThrow(/active|unresolved/);
    await expect(builder.cleanup(first.generationId)).rejects.toThrow(/owned|readable|blocked/);
    transport.release();
    const result = await pending;
    expect(result.responses.map(({ parsed }) => parsed)).toEqual([false, true, true, true, true, true]);
    expect(result.responses[1].body.result.map(({ qtyOfPatient }) => qtyOfPatient)).toEqual([2, 1, 1, 1, 1, 1]);
    expect(result).toMatchObject({
      complete: false,
      errorEvidenceVerified: true,
      queryErrors: [],
      settlement: { safe: true },
    });
    expect((await builder.cleanup(first.generationId)).removed).toEqual([first.generationId]);
    expect((await app.captureLoad({ bodyBytes })).complete).toBe(true);
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);
