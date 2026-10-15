const { MongoClient, BSON } = require("mongodb");
const { randomUUID, createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { startServer } = require("./server.cjs");
const { compareResponses } = require("./compare.cjs");
const { BASELINE_REVISION, HARNESS_REVISION, PARTS, createFixture, sourceDigest } = require("./contract-fixture.cjs");
const ROOT = path.resolve(__dirname, "../..");
const REFERENCE = path.join(__dirname, "references/legacy-six-endpoints.json");
const SUMMARY = "NCD_SUMMARY";
const SNAPSHOT = "NCD_Summary_Temp_Table";
const INDEX_KEYS = [
  { date: 1 },
  { date: 1, hcode: 1 },
  { date: 1, district: 1 },
  { date: 1, area: 1 },
  { date: 1, province: 1 },
  { date: 1, district: 1, area: 1 },
  { date: 1, district: 1, area: 1, province: 1 },
  { date: 1, hcode: 1, district: 1, area: 1, province: 1 },
];

async function openFixture(uri = process.env.PATIENTS_TEST_MONGO_URI) {
  // No .env load, remote database, credential, caller-selected DB, or existing
  // namespace is accepted. Every write and cleanup is confined to this UUID.
  if (typeof uri !== "string" || !/^mongodb:\/\/127\.0\.0\.1:\d+\/\?directConnection=true$/.test(uri)) {
    throw new Error("Set PATIENTS_TEST_MONGO_URI to mongodb://127.0.0.1:<port>/?directConnection=true");
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, monitorCommands: true });
  try {
    await client.connect();
  } catch (error) {
    await client.close();
    throw error;
  }
  const db = client.db(`patients_contract_${randomUUID().replaceAll("-", "")}`);
  try {
    for (const key of INDEX_KEYS)
      await db.collection(SUMMARY).createIndex(key, { unique: Object.keys(key).length === 2 && key.hcode === 1 });
    const { version } = await db.admin().command({ buildInfo: 1 });
    return {
      client,
      db,
      version,
      async close() {
        try {
          await db.dropDatabase();
        } finally {
          await client.close();
        }
      },
    };
  } catch (error) {
    await db.dropDatabase();
    await client.close();
    throw error;
  }
}

function archiveBaseline() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-baseline-"));
  try {
    const archive = execFileSync("git", ["archive", BASELINE_REVISION, "src"], {
      cwd: ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", directory], { input: archive });
    return {
      sourceRoot: path.join(directory, "src"),
      close: () => fs.rmSync(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function selectedSnapshots(fixture, variant) {
  if (!variant.startsWith("snapshot-") || variant === "snapshot-missing") return [];
  const [first] = fixture.snapshots.map((document) => BSON.deserialize(BSON.serialize(document)));
  if (variant === "snapshot-stale") first.created_at = new Date("2020-01-01T00:00:00Z");
  if (variant === "snapshot-empty-fields") for (const { field } of PARTS) first[field] = [];
  if (variant === "snapshot-null-fields") for (const { field } of PARTS) first[field] = null;
  if (variant === "snapshot-missing-fields") for (const { field } of PARTS) delete first[field];
  if (variant === "snapshot-multiple") {
    const second = { ...first, _id: "patients-contract-snapshot-second-v1", card_summary: [] };
    return [first, second];
  }
  return [first];
}

async function capture({ db, sourceRoot, fixture = createFixture(), cases = fixture.cases }) {
  let server;
  let previousVariant;
  const captures = [];
  try {
    for (const testCase of cases) {
      if (previousVariant !== testCase.variant) {
        const documents = fixture.fixtures[testCase.variant] || fixture.fixtures.normal;
        await db.collection(SUMMARY).deleteMany({});
        if (documents.length) await db.collection(SUMMARY).insertMany(documents);
        await db.collection(SNAPSHOT).deleteMany({});
        const snapshots = selectedSnapshots(fixture, testCase.variant);
        if (snapshots.length) await db.collection(SNAPSHOT).insertMany(snapshots);
        previousVariant = testCase.variant;
      }
      const context = { clock: testCase.clock, timeZone: testCase.timeZone, fault: testCase.fault ?? null };
      if (server) server.setCase(context);
      else server = await startServer({ db, sourceRoot, ...context, aggregateMaxTimeMS: 10000 });
      const responses = Object.fromEntries(
        await Promise.all(
          PARTS.map(async ({ id, route }) => {
            const response = await fetch(`${server.url}/ncds_api/api/v1/${route}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(testCase.body),
              signal: AbortSignal.timeout(15000),
            });
            const body = await response.json();
            const trace = await server.waitForTrace(response.headers.get("x-perf-request-id"));
            if (!trace.complete || !trace.errorEvidenceVerified)
              throw new Error(`Incomplete HTTP evidence: ${testCase.id}/${id}`);
            const sources = [...new Set(trace.aggregations.map((query) => query.source))];
            if (testCase.expectedSources && (sources.length !== 1 || sources[0] !== testCase.expectedSources[id])) {
              throw new Error(`Unexpected live/snapshot route: ${testCase.id}/${id}`);
            }
            return [
              id,
              {
                status: response.status,
                headers: { "content-type": response.headers.get("content-type") },
                body,
                source: sources.length === 1 ? sources[0] : sources,
                queryErrors: trace.queryErrors.map(({ error }) => error),
              },
            ];
          })
        )
      );
      captures.push({
        id: testCase.id,
        body: testCase.body,
        clock: testCase.clock,
        timeZone: testCase.timeZone,
        variant: testCase.variant,
        fault: testCase.fault ?? null,
        responses,
      });
      server.clearTraces();
    }
    return captures;
  } finally {
    if (server) await server.close();
  }
}

function compareCaptures(reference, candidate) {
  const differences = [];
  if (reference.length !== candidate.length) differences.push({ case: "$cases", kind: "case-count" });
  for (let index = 0; index < reference.length; index += 1) {
    const left = reference[index];
    const right = candidate[index];
    if (!right || left.id !== right.id) {
      differences.push({ case: left.id, kind: "case-identity" });
      continue;
    }
    const contextFields = ["body", "clock", "timeZone", "variant", "fault"];
    const context = compareResponses(
      { status: 200, body: Object.fromEntries(contextFields.map((field) => [field, left[field]])) },
      { status: 200, body: Object.fromEntries(contextFields.map((field) => [field, right[field]])) }
    );
    for (const difference of context.differences) differences.push({ case: left.id, field: "context", ...difference });
    for (const { id } of PARTS) {
      const expected = left.responses[id];
      const actual = right.responses[id];
      const result = compareResponses(expected, actual);
      for (const difference of result.differences) differences.push({ case: left.id, endpoint: id, ...difference });
      for (const field of ["headers", "source", "queryErrors"]) {
        const evidence = compareResponses(
          { status: 200, body: { value: expected[field] } },
          { status: 200, body: { value: actual[field] } }
        );
        for (const difference of evidence.differences)
          differences.push({ case: left.id, endpoint: id, ...difference, field });
      }
    }
  }
  return { equal: differences.length === 0, differences };
}

function toolHashes() {
  return Object.fromEntries(
    ["contract-fixture.cjs", "generate.cjs", "cases.cjs", "server.cjs", "compare.cjs"].map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, file)))
        .digest("hex"),
    ])
  );
}

async function recordBaseline() {
  const connection = await openFixture();
  const baseline = archiveBaseline();
  try {
    const fixture = createFixture();
    const first = await capture({ db: connection.db, sourceRoot: baseline.sourceRoot, fixture });
    const second = await capture({ db: connection.db, sourceRoot: baseline.sourceRoot, fixture });
    const stability = compareCaptures(first, second);
    if (!stability.equal) throw new Error(`Unstable baseline: ${stability.differences[0].case}`);
    const reference = {
      format: "patients-six-endpoint-legacy-reference-v1",
      baselineRevision: BASELINE_REVISION,
      historicalHarnessRevision: HARNESS_REVISION,
      profileId: fixture.profileId,
      fixtureSha256: sourceDigest(fixture),
      toolHashes: toolHashes(),
      runtime: {
        node: process.version,
        mongodbDriver: require("mongodb/package.json").version,
        mongoServer: connection.version,
        platform: process.platform,
        architecture: process.arch,
      },
      repeatedBaselineCapture: "exactly equal",
      snapshotIdentity: fixture.snapshots[0]._id,
      cases: first,
    };
    fs.writeFileSync(REFERENCE, `${JSON.stringify(reference)}\n`);
    return {
      cases: first.length,
      endpoints: PARTS.length,
      mongoServer: connection.version,
      fixtureSha256: reference.fixtureSha256,
    };
  } finally {
    baseline.close();
    await connection.close();
  }
}

module.exports = { REFERENCE, openFixture, archiveBaseline, capture, compareCaptures, recordBaseline };
if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== "record-baseline") {
    process.stderr.write("Usage: node scripts/patients-performance/contract.cjs record-baseline\n");
    process.exitCode = 1;
  } else
    recordBaseline().then(
      (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
      (error) => {
        process.stderr.write(`${error.name}: ${error.message}\n`);
        process.exitCode = 1;
      }
    );
}
