/* eslint-disable prettier/prettier */
import { test, expect, vi } from "vite-plus/test";
import connector from "./connect.cjs";
import runner from "./run.cjs";

test("cleanup refuses another database before issuing a delete", async () => {
  let deletes = 0;
  const db = { databaseName: "ncds", collection: () => ({ deleteMany: () => deletes++ }) };
  await expect(
    connector.removeSynthetic(db, { database: "ncds_perf_synthetic", collections: connector.COLLECTIONS })
  ).rejects.toThrow("database guard");
  expect(deletes).toBe(0);
});

test("cleanup refuses unlisted collections and invalid manifests", async () => {
  let deletes = 0;
  const db = {
    databaseName: connector.DATABASE,
    listCollections: () => ({ toArray: async () => [{ name: "foreign" }] }),
    collection: () => ({ deleteMany: () => deletes++ }),
  };
  await expect(
    connector.removeSynthetic(db, { database: connector.DATABASE, collections: connector.COLLECTIONS })
  ).rejects.toThrow("Unlisted");
  await expect(
    connector.removeSynthetic(db, { database: connector.DATABASE, collections: ["foreign"] })
  ).rejects.toThrow("manifest guard");
  expect(deletes).toBe(0);
});

test("storage gates include indexes and preserve the shared reserve", () => {
  expect(() =>
    connector.checkStorage({ projectedDataBytes: 99 * 1024 ** 2, indexAllowanceBytes: 2 * 1024 ** 2, sharedBytes: 0 })
  ).toThrow("100 MiB");
  expect(() =>
    connector.checkStorage({ projectedDataBytes: 10 * 1024 ** 2, indexAllowanceBytes: 0, sharedBytes: 380 * 1024 ** 2 })
  ).toThrow("25 percent");
  expect(
    connector.checkStorage({
      projectedDataBytes: 10 * 1024 ** 2,
      indexAllowanceBytes: 2 * 1024 ** 2,
      sharedBytes: 8 * 1024 ** 2,
    }).projectedDatabaseBytes
  ).toBe(12 * 1024 ** 2);
});

test("HTTP 200 with zeros cannot pass when aggregation failed or result is missing", () => {
  const responses = Object.fromEntries(
    runner.PARTS.map(({ id }) => [
      id,
      { status: 200, body: { status: true, result: [] }, trace: { errorEvidenceVerified: true, queryErrors: [] } },
    ])
  );
  expect(runner.validResponses(responses)).toBe(true);
  responses.bar.trace.queryErrors.push({ name: "InjectedFailure" });
  expect(runner.validResponses(responses)).toBe(false);
  responses.bar.trace.queryErrors = [];
  delete responses.dm.body.result;
  expect(runner.validResponses(responses)).toBe(false);
});

test("transport failures remain comparison failures without aborting the sample set", () => {
  expect(
    runner.compareCaptured(
      { status: 200, body: {} },
      { status: null, body: null, transportError: { name: "TimeoutError" } }
    ).equal
  ).toBe(false);
});

test("an expected Card error still requires valid Bar and graph responses", () => {
  const responses = Object.fromEntries(
    runner.PARTS.map(({ id }) => [
      id,
      { status: 200, body: { status: true, result: [] }, trace: { errorEvidenceVerified: true, queryErrors: [] } },
    ])
  );
  responses.card = { status: 500, body: { status: false }, trace: { errorEvidenceVerified: true, queryErrors: [] } };
  expect(runner.normalPartsValid(responses, responses, ["card"])).toBe(true);
  delete responses.dm.body.result;
  expect(runner.normalPartsValid(responses, responses, ["card"])).toBe(false);
});

test("combined timer stops at parsed JSON before query evidence collection", async () => {
  vi.stubGlobal("fetch", async () => ({
    status: 200,
    headers: { get: () => "test-request" },
    json: async () => ({ status: true, result: [] }),
  }));
  const start = performance.now();
  const server = {
    url: "http://127.0.0.1",
    waitForTrace: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { errorEvidenceVerified: true, queryErrors: [] };
    },
  };
  try {
    const sample = await runner.load(server, {});
    expect(performance.now() - start).toBeGreaterThanOrEqual(90);
    expect(sample.durationMs).toBeLessThan(75);
    expect(Object.values(sample.responses).every((response) => response.durationMs < 75)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
