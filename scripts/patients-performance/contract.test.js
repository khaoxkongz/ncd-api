import { afterAll, beforeAll, expect, it } from "vite-plus/test";
import fs from "node:fs";
import { REFERENCE, openFixture, archiveBaseline, capture, compareCaptures } from "./contract.cjs";
import { createFixture, sourceDigest, BASELINE_REVISION, PARTS } from "./contract-fixture.cjs";

let connection;
let baseline;
const reference = JSON.parse(fs.readFileSync(REFERENCE, "utf8"));
const fixture = createFixture();

beforeAll(async () => {
  connection = await openFixture();
  expect(connection.version).toBe(reference.runtime.mongoServer);
  expect(process.version).toBe(reference.runtime.node);
  expect(sourceDigest(fixture)).toBe(reference.fixtureSha256);
  expect(reference.baselineRevision).toBe(BASELINE_REVISION);
}, 30000);

afterAll(async () => {
  if (baseline) baseline.close();
  if (connection) await connection.close();
});

it("reproduces fixed public references from the exact accepted source revision", async () => {
  baseline = archiveBaseline();
  const actual = await capture({ db: connection.db, sourceRoot: baseline.sourceRoot, fixture });
  const comparison = compareCaptures(reference.cases, actual);
  expect(comparison.differences).toEqual([]);
}, 180000);

it("keeps legacy responses, errors, types, labels, order, and live/snapshot routing unchanged for all six routes", async () => {
  const actual = await capture({ db: connection.db, fixture });
  const comparison = compareCaptures(reference.cases, actual);
  expect(comparison.differences).toEqual([]);
  const emptyMembership = actual.find(({ id }) => id === "controlled-empty-patients-positive-scalars");
  expect(emptyMembership.responses.card).toMatchObject({
    status: 500,
    body: { status: false, message: "Internal server error" },
  });
  expect(emptyMembership.responses.expense.body.result[0]).toEqual({
    diseaseName: "โรคเบาหวาน",
    qtyOfExpense: 1,
    avg: 0,
  });
  const selected = actual.find(({ id }) => id === "snapshot-valid");
  for (const { id, field } of PARTS) {
    expect(selected.responses[id].body.result).toEqual(fixture.snapshots[0][field]);
  }
}, 180000);
