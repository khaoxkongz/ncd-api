#!/usr/bin/env node
/* eslint-disable prettier/prettier */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { parseArgs } = require("node:util");
const { BSON } = require("mongodb");
const {
  DATABASE,
  COLLECTIONS,
  connectSynthetic,
  inspectEnvironment,
  checkStorage,
  removeSynthetic,
} = require("./connect.cjs");

const ROOT = path.resolve(__dirname, "../..");
const SNAPSHOT = COLLECTIONS[1];
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
const PARTS = [
  { id: "card", route: "/card", field: "card_summary" },
  { id: "bar", route: "/bar-chart-pt", field: "chart_patient" },
  { id: "disease", route: "/graph-disease-pt", field: "disease_patient" },
  { id: "dm", route: "/graph-dm-pt", field: "dm_patient" },
  { id: "ca", route: "/graph-ca-pt", field: "ca_patient" },
];
const NORMAL_CLOCK = "2026-10-13T05:00:00.000Z";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareCaptured(reference, candidate) {
  if ([reference, candidate].some((response) => response?.transportError || !Number.isInteger(response?.status))) {
    return { equal: false, differences: [{ path: "$transport", kind: "incomplete-response" }] };
  }
  return require("./compare.cjs").compareResponses(reference, candidate);
}

function sourceIdentity() {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  if (changed) throw new Error("Baseline product source has local modifications");
  const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  const sourceHashes = Object.fromEntries(files.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]));
  const toolFiles = fs.readdirSync(__dirname).filter((name) => name.endsWith(".cjs"));
  return {
    revision,
    branch: execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim(),
    sourceHashes,
    toolHashes: Object.fromEntries(toolFiles.map((file) => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
  };
}

async function ensureOwnership(db, manifest) {
  const count = await db.collection(COLLECTIONS[0]).countDocuments();
  if (count && (await db.collection(COLLECTIONS[0]).countDocuments({ _perf_profile: { $ne: manifest.profileId } }))) {
    throw new Error("Existing summary documents do not match this synthetic profile");
  }
  if (await db.collection(SNAPSHOT).countDocuments({ _perf_profile: { $ne: manifest.profileId } })) {
    throw new Error("Existing snapshot does not match this synthetic profile");
  }
}

async function loadData(connection, workload, output) {
  const { db, client } = connection;
  const environment = await inspectEnvironment(client, db);
  const manifest = { ...workload.manifest, database: DATABASE, collections: COLLECTIONS };
  if (!manifest.profileId) throw new Error("Missing synthetic profile identity");
  await ensureOwnership(db, manifest);
  const sizes = workload.documents.map((document) => BSON.serialize(document).length);
  if (Math.max(...sizes) > 128 * 1024) throw new Error("Summary document exceeds 128 KiB");
  const storageGate = checkStorage({
    projectedDataBytes: sizes.reduce((a, b) => a + b, 0) + 1024 * 1024,
    indexAllowanceBytes: workload.documents.length * 9 * 256 + 1024 * 1024,
    sharedBytes: environment.shared.bytes,
    existingSyntheticBytes: environment.dataBytes + environment.indexBytes,
  });
  // Persist the collection allowlist before the first write, including for interrupted runs.
  writeJson(path.join(output, "manifest.json"), {
    ...manifest,
    storageGate,
    source: sourceIdentity(),
    state: "loading",
  });
  await removeSynthetic(db, manifest);
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  for (const name of COLLECTIONS) if (!names.has(name)) await db.createCollection(name);
  for (const key of INDEX_KEYS) {
    await db.collection(COLLECTIONS[0]).createIndex(key, { unique: Object.keys(key).length === 2 && key.hcode === 1 });
  }
  for (let start = 0; start < workload.documents.length; start += 50) {
    await db.collection(COLLECTIONS[0]).insertMany(workload.documents.slice(start, start + 50));
    const state = await inspectEnvironment(client, db);
    checkStorage({
      projectedDataBytes: state.dataBytes,
      indexAllowanceBytes: state.indexBytes,
      sharedBytes: state.shared.bytes,
      existingSyntheticBytes: state.dataBytes + state.indexBytes,
    });
  }
  const actual = await inspectEnvironment(client, db);
  const stored = await db.collection(COLLECTIONS[0]).find({}).sort({ _id: 1 }).toArray();
  const expected = [...workload.documents].sort((a, b) => a._id.toString().localeCompare(b._id.toString()));
  const digest = (documents) => hash(Buffer.concat(documents.map((document) => BSON.serialize(document))));
  if (stored.length !== expected.length || digest(stored) !== digest(expected))
    throw new Error("Stored workload differs from generated BSON");
  const finalManifest = {
    ...manifest,
    storageGate,
    source: sourceIdentity(),
    actual,
    storedBsonDigest: digest(stored),
    state: "loaded",
  };
  writeJson(path.join(output, "manifest.json"), finalManifest);
  return { manifest: finalManifest, environmentBefore: environment };
}

async function request(server, part, body) {
  const start = performance.now();
  let response;
  let parsed;
  let parsedCompletedAtMs;
  try {
    response = await fetch(`${server.url}/ncds_api/api/v1${part.route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    parsed = await response.json();
    parsedCompletedAtMs = performance.now();
    const durationMs = parsedCompletedAtMs - start;
    const requestId = response.headers.get("x-perf-request-id");
    const trace = await server.waitForTrace(requestId, { timeoutMs: 120000 });
    return { status: response.status, body: parsed, durationMs, parsedCompletedAtMs, trace };
  } catch (error) {
    parsedCompletedAtMs ??= performance.now();
    return {
      status: response?.status ?? null,
      body: parsed ?? null,
      durationMs: parsedCompletedAtMs - start,
      parsedCompletedAtMs,
      transportError: { name: error.name, code: error.code ?? null },
      trace: null,
    };
  }
}

async function capture(server, body) {
  const response = {};
  for (const part of PARTS) response[part.id] = await request(server, part, body);
  return response;
}

async function load(server, body) {
  const start = performance.now();
  const responses = await Promise.all(PARTS.map((part) => request(server, part, body)));
  return {
    durationMs: Math.max(...responses.map((response) => response.parsedCompletedAtMs)) - start,
    responses: Object.fromEntries(PARTS.map((part, i) => [part.id, responses[i]])),
  };
}

function validPartResponse(item) {
  return (
    item?.status === 200 &&
    item.body?.status === true &&
    Object.hasOwn(item.body, "result") &&
    item.trace?.errorEvidenceVerified === true &&
    item.trace.queryErrors.length === 0 &&
    (item.trace.suppressedConsoleErrors || 0) === 0 &&
    !item.transportError
  );
}

function validResponses(responses) {
  return PARTS.every(({ id }) => validPartResponse(responses[id]));
}

function normalPartsValid(first, repeat, expectedError) {
  const negativeParts = Array.isArray(expectedError) ? expectedError : expectedError ? PARTS.map(({ id }) => id) : [];
  return PARTS.every(
    ({ id }) => negativeParts.includes(id) || (validPartResponse(first[id]) && validPartResponse(repeat[id]))
  );
}

async function replaceSummary(db, documents, profileId) {
  await removeSynthetic(db, { database: DATABASE, collections: COLLECTIONS, profileId }, [COLLECTIONS[0]]);
  for (let start = 0; start < documents.length; start += 50) {
    await db.collection(COLLECTIONS[0]).insertMany(documents.slice(start, start + 50));
  }
}

async function makeSnapshot(db, server, clock, profileId, stale = false, timeZone = "Asia/Bangkok") {
  const snapshotClock = new Date(new Date(clock).valueOf() - (stale ? 48 * 3600000 : 0)).toISOString();
  server.setCase({ clock: snapshotClock, timeZone, fault: null });
  const body = { startDate: "2024-01-07", endDate: snapshotClock.slice(0, 10) };
  const first = await capture(server, body);
  const second = await capture(server, body);
  if (!validResponses(first) || PARTS.some(({ id }) => !compareCaptured(first[id], second[id]).equal)) {
    throw new Error("Snapshot baseline capture is invalid or unstable");
  }
  const document = { key: "main", updated_at: new Date(snapshotClock), _perf_profile: profileId };
  for (const part of PARTS) document[part.field] = first[part.id].body.result;
  if (BSON.serialize(document).length > 1024 * 1024) throw new Error("Snapshot exceeds 1 MiB");
  await removeSynthetic(db, { database: DATABASE, collections: COLLECTIONS, profileId }, [SNAPSHOT]);
  await db.collection(SNAPSHOT).insertOne(document);
  return {
    clock: snapshotClock,
    timeZone,
    updated_at: snapshotClock,
    digest: hash(JSON.stringify(Object.fromEntries(PARTS.map((part) => [part.field, document[part.field]])))),
    bsonBytes: BSON.serialize(document).length,
    ageHoursAtCaseClock: stale ? 48 : 0,
  };
}

async function run(options) {
  const { generateWorkload } = require("./generate.cjs");
  const { buildCases, buildFamilyMap } = require("./cases.cjs");
  const { summarizeAttempts } = require("./compare.cjs");
  const { startServer } = require("./server.cjs");
  const output = path.resolve(options.output);
  const workload = generateWorkload({ documentCount: options.count, pool: options.pool, seed: 20261013 });
  if (options.command === "generate") {
    writeJson(path.join(output, "generated-manifest.json"), workload.manifest);
    console.log(
      JSON.stringify({ generated: workload.documents.length, profileId: workload.manifest.profileId, output })
    );
    return;
  }
  let connection;
  let server;
  const report = {
    startedAt: new Date().toISOString(),
    source: sourceIdentity(),
    profileId: workload.manifest.profileId,
    calculationClock: NORMAL_CLOCK,
    effectiveTimeZone: "Asia/Bangkok",
    clockMethod: "Date pinned in request context; performance.now remains real",
    runtime: {
      node: process.version,
      mongoDriver: require("mongodb/package.json").version,
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      hostMemoryBytes: os.totalmem(),
    },
    atlasObservation: {
      observedDate: "2026-10-13",
      tier: "Free M0",
      region: "AWS Singapore ap-southeast-1",
      storageDisplay: "7.47 MB / 512.00 MB",
      source: "Atlas cluster UI checked before this session's first load",
      budgetAdditionalUSD: 0,
    },
    timerDefinitions: {
      endpoint: "Immediately before fetch to complete parsed JSON",
      combined: "Before parallel dispatch to all five parsed JSON bodies",
      server: "Express harness middleware request entry to response finish",
      diagnostic: "Explain operations run separately after measured requests",
    },
    limitations: [
      "Synthetic Atlas measurements cannot establish UAT latency, its bottleneck, or Patients page acceptance.",
      "No frontend source or rendering completion evidence is available; initial and filter-change page times are unmeasured.",
      "MongoDB internal cache state is uncontrolled. First trials establish only absence of application cache results.",
      "This captures baseline repeatability; no performance candidate exists.",
      "The HTTP harness mounts the five actual controllers and omits unrelated application initialization and middleware.",
    ],
  };
  try {
    connection = await connectSynthetic();
    report.connection = connection.connection;
    if (options.command === "inspect") {
      console.log(JSON.stringify(await inspectEnvironment(connection.client, connection.db), null, 2));
      return;
    }
    if (options.command === "cleanup") {
      const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json")));
      await ensureOwnership(connection.db, manifest);
      await removeSynthetic(connection.db, manifest);
      console.log(JSON.stringify({ removedDocuments: true, database: DATABASE, retainedIndexes: true }));
      return;
    }
    const loaded = await loadData(connection, workload, output);
    report.environmentBefore = loaded.environmentBefore;
    report.manifest = loaded.manifest;
    const { db } = connection;
    server = await startServer({ db, clock: NORMAL_CLOCK, timeZone: "Asia/Bangkok", aggregateMaxTimeMS: 120000 });
    const liveBody = { startDate: "2024-01-01", endDate: "2026-10-13" };
    const rawFirst = [];
    // No reference capture or same-request warmup precedes these first trials.
    for (let attempt = 0; attempt < 20; attempt++) {
      server.setCase({ clock: NORMAL_CLOCK, timeZone: "Asia/Bangkok", fault: null });
      rawFirst.push(await load(server, liveBody));
      console.log(
        JSON.stringify({ phase: "first-live", attempt: attempt + 1, durationMs: rawFirst.at(-1).durationMs })
      );
      writeJson(path.join(output, "first-live-raw.json"), rawFirst);
    }
    const reference = await capture(server, liveBody);
    const repeatedReference = await capture(server, liveBody);
    if (PARTS.some(({ id }) => !compareCaptured(reference[id], repeatedReference[id]).equal))
      throw new Error("Timing reference is unstable");
    writeJson(path.join(output, "timing-reference-live.json"), {
      body: liveBody,
      clock: NORMAL_CLOCK,
      timeZone: "Asia/Bangkok",
      reference,
      repeatedReference,
    });
    function classify(sample, expected, source) {
      const differences = Object.fromEntries(
        PARTS.map(({ id }) => [id, compareCaptured(expected[id], sample.responses[id])])
      );
      const sourceVerified = PARTS.every(({ id }) =>
        sample.responses[id].trace?.aggregations.every((aggregation) => aggregation.source === source)
      );
      const queryErrors = PARTS.flatMap(
        ({ id }) => sample.responses[id].trace?.queryErrors || [{ name: "UnverifiedQueryEvidence" }]
      );
      return {
        ...sample,
        correct: Object.values(differences).every((difference) => difference.equal),
        complete: validResponses(sample.responses),
        errorEvidenceVerified:
          PARTS.every(({ id }) => sample.responses[id].trace?.errorEvidenceVerified === true) && sourceVerified,
        queryErrors,
        differences,
        sourceVerified,
      };
    }
    report.timings = [
      {
        id: "first-live-national-longest",
        body: liveBody,
        warmupCount: 0,
        attemptedLoads: rawFirst.map((sample) => classify(sample, reference, "live")),
      },
    ];
    for (let i = 0; i < 5; i++) await load(server, liveBody);
    const laterLive = [];
    for (let i = 0; i < 20; i++) {
      laterLive.push(classify(await load(server, liveBody), reference, "live"));
      console.log(JSON.stringify({ phase: "later-live", attempt: i + 1, durationMs: laterLive.at(-1).durationMs }));
    }
    report.timings.push({
      id: "later-live-national-longest",
      body: liveBody,
      warmupCount: 5,
      attemptedLoads: laterLive,
    });
    const snapshotIdentity = await makeSnapshot(db, server, NORMAL_CLOCK, workload.manifest.profileId);
    const cacheBody = {
      startDate: "2024-01-07",
      endDate: "2026-10-13",
      area: "",
      province: "",
      district: "",
      hcode: "",
    };
    server.setCase({ clock: NORMAL_CLOCK, timeZone: "Asia/Bangkok", fault: null });
    const cacheReference = await capture(server, cacheBody);
    const cacheRepeated = await capture(server, cacheBody);
    if (
      !validResponses(cacheReference) ||
      PARTS.some(({ id }) => !compareCaptured(cacheReference[id], cacheRepeated[id]).equal)
    )
      throw new Error("Snapshot timing reference is unstable");
    writeJson(path.join(output, "timing-reference-snapshot.json"), {
      body: cacheBody,
      snapshotIdentity,
      reference: cacheReference,
      repeatedReference: cacheRepeated,
    });
    for (let i = 0; i < 5; i++) await load(server, cacheBody);
    const laterSnapshot = [];
    for (let i = 0; i < 20; i++) {
      laterSnapshot.push(classify(await load(server, cacheBody), cacheReference, "snapshot"));
      console.log(
        JSON.stringify({ phase: "later-snapshot", attempt: i + 1, durationMs: laterSnapshot.at(-1).durationMs })
      );
    }
    report.timings.push({
      id: "later-snapshot-national",
      body: cacheBody,
      snapshotIdentity,
      warmupCount: 5,
      attemptedLoads: laterSnapshot,
    });
    for (const scenario of report.timings) {
      scenario.summary = summarizeAttempts(scenario.attemptedLoads, { requiredAttempts: 20 });
      delete scenario.summary.samples; // attemptedLoads already retains every response and trace.
    }
    report.firstSnapshot =
      "Inapplicable to the first-request no-application-cache condition: stored snapshots are application cache results.";
    writeJson(path.join(output, "report.json"), report);

    const cases = buildCases(workload.fixtures);
    report.caseFamilies = buildFamilyMap(cases);
    report.comparisons = [];
    let summaryVariant = "normal";
    for (const item of cases) {
      const variant = item.variant || "normal";
      const nextSummaryVariant = ["empty", "empty-patients"].includes(variant) ? variant : "normal";
      if (summaryVariant !== nextSummaryVariant) {
        const documents =
          nextSummaryVariant === "empty"
            ? []
            : nextSummaryVariant === "empty-patients"
              ? workload.documents.filter(
                  (document) =>
                    document._perf_kind === "fixed" &&
                    document.hcode === "SYN-H22" &&
                    document.date.toISOString().startsWith("2026-10-05")
                )
              : workload.documents;
        if (nextSummaryVariant === "empty-patients" && documents.length !== 1)
          throw new Error("Missing controlled empty-patients fixture");
        await replaceSummary(db, documents, workload.manifest.profileId);
        summaryVariant = nextSummaryVariant;
      }
      await removeSynthetic(db, loaded.manifest, [SNAPSHOT]);
      let snapshot = null;
      if (["snapshot-valid", "snapshot-stale"].includes(variant))
        snapshot = await makeSnapshot(
          db,
          server,
          item.clock,
          workload.manifest.profileId,
          variant === "snapshot-stale",
          item.timeZone
        );
      server.setCase({
        clock: item.clock,
        timeZone: item.timeZone || item.timezone || "Asia/Bangkok",
        fault: item.fault || null,
      });
      const first = await capture(server, item.body);
      const repeat = await capture(server, item.body);
      const differences = Object.fromEntries(PARTS.map(({ id }) => [id, compareCaptured(first[id], repeat[id])]));
      const stable = Object.values(differences).every((difference) => difference.equal);
      const evidenceVerified = PARTS.every(
        ({ id }) => first[id].trace?.errorEvidenceVerified && repeat[id].trace?.errorEvidenceVerified
      );
      const queryFailures = PARTS.flatMap(({ id }) => [
        ...(first[id].trace?.queryErrors || []),
        ...(repeat[id].trace?.queryErrors || []),
      ]);
      const expectedNegative =
        item.expectedError ||
        item.expectedErrors ||
        ["snapshot-missing", "empty-patients"].includes(variant) ||
        Boolean(item.fault);
      const unexpectedQueryFailure = queryFailures.length > 0 && !expectedNegative;
      const normalResponsesValid = normalPartsValid(first, repeat, item.expectedError);
      const sourceMatches =
        !item.expectedSources ||
        PARTS.every(({ id }) =>
          [first[id], repeat[id]].every((response) =>
            response.trace?.aggregations.every((aggregation) => aggregation.source === item.expectedSources[id])
          )
        );
      const comparison = {
        case: item,
        snapshot,
        reference: first,
        repeat,
        differences,
        stable,
        evidenceVerified,
        queryFailureCount: queryFailures.length,
        unexpectedQueryFailure,
        normalResponsesValid,
        sourceMatches,
        passed: stable && evidenceVerified && !unexpectedQueryFailure && sourceMatches && normalResponsesValid,
      };
      report.comparisons.push({
        id: item.id,
        passed: comparison.passed,
        stable,
        evidenceVerified,
        sourceMatches,
        unexpectedQueryFailure,
        normalResponsesValid,
        queryFailureCount: queryFailures.length,
      });
      writeJson(path.join(output, "references", `${item.id}.json`), comparison);
      writeJson(path.join(output, "report.json"), report);
      console.log(JSON.stringify({ phase: "comparison", case: item.id, passed: comparison.passed }));
    }
    if (summaryVariant !== "normal") await replaceSummary(db, workload.documents, workload.manifest.profileId);
    report.finalSnapshot = await makeSnapshot(db, server, NORMAL_CLOCK, workload.manifest.profileId);
    report.environmentAfter = await inspectEnvironment(connection.client, db);
    report.diagnostics = [];
    const pipelines = server.getPipelines();
    const seen = new Set();
    for (const entry of pipelines) {
      const key = `${entry.collection}:${entry.shapeFingerprint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const explain = await db
          .collection(entry.collection)
          .aggregate(entry.pipeline, { maxTimeMS: 120000 })
          .explain("executionStats");
        report.diagnostics.push({
          collection: entry.collection,
          shapeFingerprint: entry.shapeFingerprint,
          pipelineFingerprint: entry.pipelineFingerprint,
          explain,
        });
      } catch (error) {
        report.diagnostics.push({
          collection: entry.collection,
          shapeFingerprint: key,
          error: { name: error.name, code: error.code ?? null },
        });
      }
    }
    report.completedAt = new Date().toISOString();
    report.comparisonPassed = report.comparisons.every((item) => item.passed);
    report.exploratoryApiTimingPassed = report.timings.every((scenario) => scenario.summary.timingPassed);
    report.actualPageAcceptance = "unmeasured";
    writeJson(path.join(output, "report.json"), report);
    writeJson(path.join(output, "manifest.json"), {
      ...loaded.manifest,
      finalSnapshot: report.finalSnapshot,
      actual: report.environmentAfter,
      state: "measured",
    });
    console.log(
      JSON.stringify(
        {
          output,
          comparisons: report.comparisons.length,
          passed: report.comparisonPassed,
          timings: report.timings.map(({ id, summary }) => ({
            id,
            attempted: summary.attempted,
            p95Ms: summary.p95Ms,
            failed: summary.failed,
          })),
        },
        null,
        2
      )
    );
    if (!report.comparisonPassed || !report.exploratoryApiTimingPassed) process.exitCode = 1;
  } finally {
    await server?.close();
    await connection?.client.close();
  }
}

if (require.main === module) {
  const { values } = parseArgs({
    options: {
      command: { type: "string", default: "run" },
      output: { type: "string", default: "docs/wayfinder/patients-performance/results/atlas-1000" },
      count: { type: "string", default: "1000" },
      pool: { type: "string", default: "fixed" },
    },
  });
  if (!["run", "generate", "inspect", "cleanup"].includes(values.command)) throw new Error("Unknown command");
  run({ ...values, count: Number(values.count) }).catch((error) => {
    // Error messages from network/driver libraries can contain credentials; retain only their type/code.
    console.error(JSON.stringify({ failed: true, name: error.name, code: error.code ?? null }));
    process.exitCode = 1;
  });
}

module.exports = {
  PARTS,
  INDEX_KEYS,
  sourceIdentity,
  validResponses,
  normalPartsValid,
  ensureOwnership,
  compareCaptured,
  request,
  load,
  run,
};
