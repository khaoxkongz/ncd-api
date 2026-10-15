import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { startServer } from "./server.cjs";

let client;
let db;
let server;
const routes = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];

beforeAll(async () => {
  const uri = process.env.PATIENTS_TEST_MONGO_URI;
  if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\/\?directConnection=true$/.test(uri)) {
    throw new Error("Set PATIENTS_TEST_MONGO_URI to an explicit credential-free loopback fixture server");
  }
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(`patients_contract_${randomUUID().replaceAll("-", "")}`);
});

afterAll(async () => {
  if (server) await server.close();
  if (db) await db.dropDatabase();
  if (client) await client.close();
});

it("serves successful baseline envelopes through all six HTTP controllers on an empty MongoDB fixture", async () => {
  server = await startServer({ db, clock: "2026-10-13T05:00:00.000Z", timeZone: "Asia/Bangkok" });
  const responses = await Promise.all(
    routes.map(async (route) => {
      const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: "2024-01-01", endDate: "2026-10-13" }),
      });
      return { status: response.status, body: await response.json() };
    })
  );
  expect(responses.map(({ status, body }) => [status, body.status, body.message])).toEqual(
    routes.map(() => [200, true, "success"])
  );
  expect(responses[0].body.result).toEqual([
    { service_count: 0, patient_count: 0, expense: 0, hcode_count: 0, avg_service: 0, avg_expense: 0 },
  ]);
  expect(responses[1].body.result.map((row) => row.qtyOfPatient)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(responses[2].body.result.map((row) => row.qtyOfExpense)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(responses.slice(3).map(({ body }) => body.result.length)).toEqual([7, 5, 6]);
});

it("blocks an unvalidated read-model selection for every route before source reads", async () => {
  const previous = process.env.NCD_PATIENTS_BACKEND;
  process.env.NCD_PATIENTS_BACKEND = "read-model";
  try {
    const responses = await Promise.all(
      routes.map(async (route) => {
        const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ startDate: "2024-01-01", endDate: "2026-10-13" }),
        });
        const trace = await server.waitForTrace(response.headers.get("x-perf-request-id"));
        return { status: response.status, body: await response.json(), reads: trace.aggregations.length };
      })
    );
    expect(responses).toEqual(
      routes.map(() => ({
        status: 503,
        body: { status: false, message: "Read model unavailable" },
        reads: 0,
      }))
    );
  } finally {
    if (previous === undefined) delete process.env.NCD_PATIENTS_BACKEND;
    else process.env.NCD_PATIENTS_BACKEND = previous;
  }
});

it("rejects an unknown shared backend configuration without reading legacy data", async () => {
  const previous = process.env.NCD_PATIENTS_BACKEND;
  process.env.NCD_PATIENTS_BACKEND = "unsupported-fixture-mode";
  try {
    const responses = await Promise.all(
      routes.map(async (route) => {
        const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const trace = await server.waitForTrace(response.headers.get("x-perf-request-id"));
        return { status: response.status, body: await response.json(), reads: trace.aggregations.length };
      })
    );
    expect(responses).toEqual(
      routes.map(() => ({
        status: 500,
        body: { status: false, message: "Internal server error" },
        reads: 0,
      }))
    );
  } finally {
    if (previous === undefined) delete process.env.NCD_PATIENTS_BACKEND;
    else process.env.NCD_PATIENTS_BACKEND = previous;
  }
});
