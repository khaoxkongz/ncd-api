/* eslint-disable prettier/prettier */
import { afterEach, describe, expect, it } from "vite-plus/test";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { startServer } from "./server.cjs";

const require = createRequire(import.meta.url);
const ROUTES = ["card", "bar-chart-pt", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const CLOCK = "2026-03-01T00:30:00.000Z";
let server;

afterEach(async () => {
  if (server) await server.close();
  server = undefined;
});

function fakeDatabase(consume = async () => []) {
  const calls = [];
  return {
    databaseName: "patients_synthetic_test",
    calls,
    collection(collection) {
      return {
        aggregate(pipeline, options) {
          calls.push({ collection, pipeline, options });
          return { toArray: () => consume({ collection, pipeline, options }) };
        },
      };
    },
  };
}

async function post(route, body = { startDate: "2025-01-01", endDate: "2026-01-01" }) {
  const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = { status: response.status, body: await response.json() };
  result.trace = await server.waitForTrace(response.headers.get("x-perf-request-id"));
  return result;
}

function snapshotBody() {
  return { startDate: "2024-01-07", endDate: "2026-03-01", area: "", province: "", district: "", hcode: "" };
}

describe("Patients baseline controller HTTP seam", () => {
  it("runs all five real controllers in parallel and attributes each aggregation to its request", async () => {
    const db = fakeDatabase();
    server = await startServer({ db, clock: CLOCK, timeZone: "UTC", aggregateMaxTimeMS: 120000 });
    const responses = await Promise.all(ROUTES.map((route) => post(route)));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(responses.map((response) => response.trace.aggregations.length)).toEqual([2, 7, 6, 5, 6]);
    expect(new Set(responses.map((response) => response.trace.requestId)).size).toBe(5);
    expect(db.calls).toHaveLength(26);
    expect(responses[0].body.result).toEqual([
      { service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 },
    ]);
    expect(responses[1].body.result).toHaveLength(6);
    for (const response of responses) {
      expect(response.trace.complete).toBe(true);
      expect(response.trace.errorEvidenceVerified).toBe(true);
      expect(response.trace.queryErrors).toEqual([]);
      expect(response.trace.processingMs).toBeGreaterThan(0);
      expect(response.trace.aggregations.every((query) => query.source === "live" && query.success)).toBe(true);
      expect(response.trace.aggregations.every((query) => query.maxTimeMS === 120000)).toBe(true);
      expect(response.trace.aggregations.every((query) => /^[a-f0-9]{64}$/.test(query.pipelineFingerprint))).toBe(true);
    }
    for (const response of responses.slice(2)) {
      expect(
        response.body.result.every((series) => series.data.length === 12 && series.data.every((value) => value === 0))
      ).toBe(true);
    }
    expect(require.cache[require.resolve("../../src/lib/discord.js")]).toBeUndefined();
    expect(require.cache[require.resolve("../../src/modules/migration/migration.routes.js")]).toBeUndefined();
    expect(require.cache[require.resolve("../../src/env.js")]).toBeUndefined();
  });

  it("pins UTC cache routing and local graph months while leaving database and elapsed clocks real", async () => {
    const databaseTimes = [];
    const snapshot = { card_summary: ["snapshot-card"] };
    const db = fakeDatabase(async ({ collection }) => {
      databaseTimes.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
      return collection === "NCD_Summary_Temp_Table" ? [snapshot] : [];
    });
    server = await startServer({ db, clock: CLOCK, timeZone: "America/Los_Angeles" });
    const before = performance.now();
    const card = await post("card", snapshotBody());
    const graph = await post("graph-disease-pt", { year: 1990, startDate: "1990-01-01", endDate: "1990-12-31" });
    expect(card.body.result).toEqual(["snapshot-card"]);
    expect(card.trace.aggregations[0].source).toBe("snapshot");
    expect(card.trace.effectiveTimeZone).toBe("America/Los_Angeles");
    expect(graph.trace.clock).toBe(CLOCK);
    const firstGraphPipeline = server
      .getPipelines()
      .find((item) => item.pipelineFingerprint === graph.trace.aggregations[0].pipelineFingerprint);
    expect(firstGraphPipeline.pipeline[0].$match.$and[1].$or.at(-1)).toEqual({ year: 2026, month: 2 });
    expect(databaseTimes.every((instant) => Math.abs(instant - new Date().getTime()) < 10000)).toBe(true);
    expect(card.trace.processingMs).toBeGreaterThanOrEqual(15);
    expect(performance.now() - before).toBeGreaterThanOrEqual(35);

    server.setCase({ clock: CLOCK, timeZone: "Asia/Bangkok" });
    const next = await post("graph-disease-pt");
    const nextPipeline = server
      .getPipelines()
      .find((item) => item.pipelineFingerprint === next.trace.aggregations[0].pipelineFingerprint);
    expect(next.trace.effectiveTimeZone).toBe("Asia/Bangkok");
    expect(nextPipeline.pipeline[0].$match.$and[1].$or.at(-1)).toEqual({ year: 2026, month: 3 });
  });

  it("distinguishes empty-string snapshot routing from omitted graph filters", async () => {
    const snapshot = {
      card_summary: ["card"],
      chart_patient: ["bar"],
      disease_patient: ["disease"],
      dm_patient: ["dm"],
      ca_patient: ["ca"],
    };
    const db = fakeDatabase(async ({ collection }) => (collection === "NCD_Summary_Temp_Table" ? [snapshot] : []));
    server = await startServer({ db, clock: CLOCK });
    const snapshots = await Promise.all(ROUTES.map((route) => post(route, snapshotBody())));
    expect(snapshots.map((response) => response.body.result)).toEqual([["card"], ["bar"], ["disease"], ["dm"], ["ca"]]);
    expect(
      snapshots.every(
        (response) => response.trace.aggregations.length === 1 && response.trace.aggregations[0].source === "snapshot"
      )
    ).toBe(true);

    const loose = await Promise.all(
      ROUTES.map((route) =>
        post(route, {
          ...snapshotBody(),
          area: false,
          province: 0,
          district: false,
          hcode: 0,
        })
      )
    );
    expect(loose.slice(0, 2).every((response) => response.trace.aggregations[0].source === "snapshot")).toBe(true);
    expect(
      loose.slice(2).every((response) => response.trace.aggregations.every((query) => query.source === "live"))
    ).toBe(true);
  });

  it("retains suppressed query failures even when the baseline emits HTTP 200 and zero values", async () => {
    const db = fakeDatabase();
    server = await startServer({ db, clock: CLOCK, fault: "aggregate" });
    const [card, bar, disease] = await Promise.all([post("card"), post("bar-chart-pt"), post("graph-disease-pt")]);
    expect(card.status).toBe(500);
    expect(card.body).toEqual({ status: false, message: "Internal server error" });
    expect(bar.status).toBe(200);
    expect(bar.body.result.every((item) => item.qtyOfPatient === 0 && item.avg === 0)).toBe(true);
    expect(bar.trace.queryErrors).toHaveLength(7);
    expect(bar.trace.suppressedConsoleErrors).toBeGreaterThanOrEqual(7);
    expect(bar.trace.errorEvidenceVerified).toBe(true);
    expect(disease.status).toBe(200);
    expect(disease.body).not.toHaveProperty("result");
    expect(disease.trace.queryErrors).toHaveLength(6);
    server.setCase({ fault: null });
    const recovered = await post("bar-chart-pt");
    expect(recovered.trace.queryErrors).toEqual([]);
  });

  it("keeps missing snapshots distinct from aggregation failures and supports faults on snapshots", async () => {
    server = await startServer({ db: fakeDatabase(), clock: CLOCK });
    const missing = await post("card", snapshotBody());
    expect(missing.status).toBe(200);
    expect(missing.body).not.toHaveProperty("result");
    expect(missing.trace.aggregations[0].success).toBe(true);
    expect(missing.trace.suppressedConsoleErrors).toBe(1);
    server.setCase({ fault: "controller" });
    const failed = await post("card", snapshotBody());
    expect(failed.body).not.toHaveProperty("result");
    expect(failed.trace.queryErrors).toHaveLength(1);
    expect(failed.trace.queryErrors[0].error.code).toBe("PERF_INJECTED_AGGREGATE");
  });

  it("refuses case changes during active requests and restores process globals after closing", async () => {
    const originalDate = Date;
    const originalTimeZone = process.env.TZ;
    const originalConsoleError = console.error;
    let release;
    let started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    const blocker = new Promise((resolve) => {
      release = resolve;
    });
    server = await startServer({
      db: fakeDatabase(async () => {
        started();
        await blocker;
        return [];
      }),
      clock: CLOCK,
    });
    const pending = post("card");
    await began;
    expect(() => server.setCase({ clock: "2027-01-01T00:00:00Z" })).toThrow("active");
    await expect(startServer({ db: fakeDatabase(), clock: CLOCK })).rejects.toThrow("Only one");
    release();
    await pending;
    await server.close();
    expect(Date).toBe(originalDate);
    expect(process.env.TZ).toBe(originalTimeZone);
    expect(console.error).toBe(originalConsoleError);
  });

  it("exports only safe failure diagnostics and unique pipeline fingerprints", async () => {
    const sensitive = "synthetic-patient-private-value";
    const db = fakeDatabase(async () => {
      throw new Error(`mongodb://user:password@private-host/records cid=${sensitive}`);
    });
    server = await startServer({ db, clock: CLOCK });
    const first = await post("bar-chart-pt", { startDate: "2025-01-01", endDate: "2026-01-01", hcode: sensitive });
    const pipelineCount = server.getPipelines().length;
    const second = await post("bar-chart-pt", { startDate: "2025-01-01", endDate: "2026-01-01", hcode: sensitive });
    expect(server.getPipelines()).toHaveLength(pipelineCount);
    expect(first.trace.aggregations.map((query) => query.pipelineFingerprint)).toEqual(
      second.trace.aggregations.map((query) => query.pipelineFingerprint)
    );
    expect(JSON.stringify(first.trace)).not.toMatch(/password|private-host|synthetic-patient-private-value/);
    expect(first.trace.queryErrors).toHaveLength(7);
  });
});
