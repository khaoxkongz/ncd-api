const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { BSON } = require("mongodb");
const { digest } = require("./capacity");
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
function reference(test) {
  return digest({
    clock: test.clock,
    timeZone: test.timeZone,
    contextSha256: test.contextSha256,
    responses: test.responses.map((row) => ({
      route: row.route,
      status: row.expectedStatus,
      bodySha256: row.expectedBodySha256,
      headersSha256: row.expectedHeadersSha256,
    })),
  });
}
function routing(test, request) {
  const fields = ["area", "province", "district", "hcode"];
  const graph = fields.every((field) => request[field] === "");
  const range =
    request.startDate == "2024-01-07" &&
    request.endDate == new Date(test.clock).toISOString().slice(0, 10) &&
    fields.every((field) => request[field] == "");
  return graph === range ? (graph ? "snapshot" : "live") : "mixed";
}
// Files contain one exact condition binding, then compact lossless records.
// A dictionary index denotes the observed receipt/digest values, not a pass bit.
function expand(row, page, need) {
  if (!Array.isArray(row)) return row;
  need(row.length === 9 && [0, 1].includes(row[0]) && integer(row[7]) && row[7] < page.apiReceipts.length);
  return {
    kind: row[0] === 0 ? "warmup" : "attempt",
    id: row[1],
    session: row[2],
    actionAt: row[3],
    apiCompletedAt: row[4],
    renderedAt: row[5],
    errors: row[6],
    api: page.apiReceipts[row[7]],
    responses: row[8],
  };
}
async function* records(condition, binding, directory, budget, footprint, need) {
  if (condition.attempts) {
    need(!condition.series && Array.isArray(condition.attempts) && Array.isArray(condition.warmups));
    for (const row of condition.warmups) yield { ...row, kind: "warmup" };
    for (const row of condition.attempts) yield { ...row, kind: "attempt" };
    return;
  }
  const file = condition.series;
  need(
    file &&
      typeof directory === "string" &&
      sha(file.sha256) &&
      file.filename === `series-${file.sha256}.ndjson` &&
      integer(file.bytes) &&
      file.bytes > 0 &&
      file.bytes <= 131072 &&
      integer(file.records) &&
      file.records > 0 &&
      file.records <= 106
  );
  footprint.bytes += file.bytes;
  need(footprint.bytes <= 8 * 1048576);
  await budget.admitAdditional(262144);
  const lease = await budget.reserveSerialized(65536);
  let fd, release, releaseTail;
  try {
    fd = await fs.open(path.join(directory, file.filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await fd.stat();
    need(stat.isFile() && stat.size === file.bytes && integer(stat.blocks) && integer(stat.dev) && integer(stat.ino));
    const identity = `${stat.dev}:${stat.ino}`;
    if (!footprint.physical.has(identity)) {
      footprint.physical.add(identity);
      footprint.allocated += Math.max(stat.size, stat.blocks * 512);
    }
    const buffer = Buffer.allocUnsafeSlow(16384);
    release = lease.hold(buffer);
    let tail = Buffer.alloc(0),
      bytes = 0,
      count = 0;
    const hash = createHash("sha256");
    for (;;) {
      budget.check();
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      need(bytes <= file.bytes);
      hash.update(buffer.subarray(0, bytesRead));
      const combined = Buffer.concat([tail, buffer.subarray(0, bytesRead)]),
        held = lease.hold(combined);
      releaseTail?.();
      releaseTail = held;
      tail = combined;
      let end;
      while ((end = tail.indexOf(10)) >= 0) {
        need(end > 0 && end <= 16384);
        const stringReservation = budget.hold(null, "reservation", end * 2);
        let row, releaseRow;
        try {
          row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(tail.subarray(0, end)));
          releaseRow = budget.hold(row, "decoded", BSON.calculateObjectSize({ value: row }) * 4);
        } finally {
          stringReservation();
        }
        tail = tail.subarray(end + 1);
        try {
          count += 1;
          need(count <= file.records);
          if (count === 1) need(digest(row) === digest(binding));
          else yield row;
        } finally {
          releaseRow?.();
        }
      }
      need(tail.length <= 16384);
      if (!tail.length) {
        releaseTail();
        releaseTail = undefined;
        tail = Buffer.alloc(0);
      }
    }
    const after = await fd.stat();
    need(
      !tail.length &&
        bytes === file.bytes &&
        count === file.records &&
        hash.digest("hex") === file.sha256 &&
        after.size === stat.size &&
        after.mtimeMs === stat.mtimeMs &&
        after.ctimeMs === stat.ctimeMs
    );
  } finally {
    await fd?.close();
    releaseTail?.();
    release?.();
    await lease.release();
  }
}
async function verifySeries(page, correctness, families, { recordsDirectory, budget, inventory }) {
  const need = (value) => {
    if (!value) {
      const error = new Error("Release timing matrix unavailable");
      error.releaseReason = "release-gate-page";
      throw error;
    }
  };
  need(
    Array.isArray(page.scenarios) &&
      page.scenarios.length === correctness.cases.length &&
      page.scenarios.length <= 512 &&
      inventory?.schema === "patients-required-timing-scenarios-v1" &&
      inventory.count === page.scenarios.length &&
      sha(inventory.sha256) &&
      inventory.sha256 === digest({ scenarios: page.scenarios })
  );
  need(Array.isArray(page.apiReceipts) && page.apiReceipts.length > 0 && page.apiReceipts.length <= 128);
  const scenarios = new Map(),
    identities = new Set();
  for (const item of page.scenarios) {
    need(validId(item.id) && !scenarios.has(item.id));
    const test = correctness.cases.find((row) => row.id === item.id);
    need(
      test &&
        digest({ values: item.families }) === digest({ values: test.families }) &&
        item.requestSha256 === test.requestSha256 &&
        typeof item.requestBytes === "string" &&
        Buffer.byteLength(item.requestBytes) <= 65536 &&
        createHash("sha256").update(item.requestBytes).digest("hex") === item.requestSha256 &&
        typeof item.contextBytes === "string" &&
        Buffer.byteLength(item.contextBytes) <= 16384 &&
        createHash("sha256").update(item.contextBytes).digest("hex") === item.contextSha256 &&
        item.contextSha256 === test.contextSha256 &&
        item.referenceSha256 === reference(test)
    );
    const request = JSON.parse(item.requestBytes),
      context = JSON.parse(item.contextBytes);
    need(
      request &&
        !Array.isArray(request) &&
        typeof request === "object" &&
        context &&
        !Array.isArray(context) &&
        typeof context === "object" &&
        item.routing === routing(test, request)
    );
    const identity = digest({
      requestSha256: item.requestSha256,
      clock: test.clock,
      timeZone: test.timeZone,
      contextSha256: item.contextSha256,
    });
    need(!identities.has(identity));
    identities.add(identity);
    scenarios.set(item.id, { ...item, test, positive: test.responses.every((row) => row.expectedStatus === 200) });
  }
  for (const family of families) need([...scenarios.values()].some((item) => item.families.includes(family)));
  for (const mode of ["live", "snapshot"])
    need([...scenarios.values()].some((item) => item.positive && item.routing === mode));
  const negative = [...scenarios.values()].filter((item) => !item.positive);
  need(Array.isArray(page.negativeComparisons) && page.negativeComparisons.length === negative.length);
  for (const item of negative)
    need(
      page.negativeComparisons.filter(
        (row) =>
          row.scenarioId === item.id &&
          row.requestSha256 === item.requestSha256 &&
          row.referenceSha256 === item.referenceSha256 &&
          row.responsesSha256 === digest({ values: item.test.responses })
      ).length === 1
    );
  const positive = [...scenarios.values()].filter((item) => item.positive);
  need(
    Array.isArray(page.conditions) && page.conditions.length === positive.length * 4 && page.conditions.length <= 512
  );
  const keys = new Set(),
    conditionIds = new Set(),
    sessions = new Set(),
    result = [];
  const footprint = { bytes: 0, allocated: 0, physical: new Set() };
  for (const condition of page.conditions) {
    const scenario = scenarios.get(condition.scenarioId),
      count = condition.phase === "explore" ? 20 : 100;
    need(
      validId(condition.id) &&
        !conditionIds.has(condition.id) &&
        scenario?.positive &&
        ["explore", "acceptance"].includes(condition.phase) &&
        ["first", "later"].includes(condition.trial) &&
        condition.routing === scenario.routing
    );
    conditionIds.add(condition.id);
    const key = `${condition.scenarioId}:${condition.phase}:${condition.trial}`;
    need(!keys.has(key));
    keys.add(key);
    need(digest({ values: scenario.test.responses }) === condition.responseDictionarySha256);
    const dictionary = scenario.test.responses.map((row) => ({
      route: row.route,
      status: row.actualStatus,
      bodySha256: row.actualBodySha256,
      headersSha256: row.actualHeadersSha256,
    }));
    need(
      dictionary.every(
        (row, i) =>
          row.route === ROUTES[i] &&
          row.status === 200 &&
          row.bodySha256 === scenario.test.responses[i].expectedBodySha256 &&
          row.headersSha256 === scenario.test.responses[i].expectedHeadersSha256
      )
    );
    const binding = {
      kind: "binding",
      conditionId: condition.id,
      scenarioId: scenario.id,
      requestSha256: scenario.requestSha256,
      referenceSha256: scenario.referenceSha256,
      routing: scenario.routing,
      phase: condition.phase,
      trial: condition.trial,
    };
    const samples = [],
      apiSamples = [],
      ids = new Set(),
      currentSessions = new Set();
    let warmups = 0,
      attempts = 0;
    for await (const record of records(condition, binding, recordsDirectory, budget, footprint, need)) {
      const row = expand(record, page, need);
      budget.check();
      need(validId(row.id) && !ids.has(row.id) && validId(row.session) && ["warmup", "attempt"].includes(row.kind));
      ids.add(row.id);
      const warmup = row.kind === "warmup";
      if (warmup) {
        warmups += 1;
        need(attempts === 0 && condition.trial === "later" && warmups <= 5);
      } else {
        attempts += 1;
        need(attempts <= count);
      }
      currentSessions.add(row.session);
      if (condition.trial === "first") {
        need(!sessions.has(row.session));
        sessions.add(row.session);
      }
      const api = row.api;
      const responses = Array.isArray(row.responses)
        ? row.responses.map((value) =>
            Array.isArray(value)
              ? { ...dictionary[value[0]], parsedAt: row.actionAt + value[1], renderedForCurrentLoad: value[2] === 1 }
              : value
          )
        : null;
      const correct =
        integer(row.actionAt) &&
        integer(row.apiCompletedAt) &&
        integer(row.renderedAt) &&
        row.apiCompletedAt >= row.actionAt &&
        row.renderedAt >= row.apiCompletedAt &&
        row.errors === 0 &&
        api &&
        integer(api.commandsStarted) &&
        api.commandsStarted > 0 &&
        api.commandsStarted === api.commandsSettled &&
        api.activeCommands === 0 &&
        api.queryErrors === 0 &&
        api.overflow === 0 &&
        api.proof === "reader-shared-renewals-http-and-capacity-settled" &&
        Array.isArray(responses) &&
        responses.length === 6 &&
        responses.every(
          (value, i) =>
            value?.route === ROUTES[i] &&
            value.status === 200 &&
            value.bodySha256 === scenario.test.responses[i].expectedBodySha256 &&
            value.headersSha256 === scenario.test.responses[i].expectedHeadersSha256 &&
            integer(value.parsedAt) &&
            value.parsedAt >= row.actionAt &&
            value.parsedAt <= row.apiCompletedAt &&
            value.renderedForCurrentLoad === true
        );
      if (warmup) need(correct);
      else {
        samples.push(correct ? row.renderedAt - row.actionAt : Infinity);
        apiSamples.push(correct ? row.apiCompletedAt - row.actionAt : Infinity);
      }
    }
    need(
      attempts === count &&
        warmups === (condition.trial === "later" ? 5 : 0) &&
        currentSessions.size === (condition.trial === "first" ? count : 1)
    );
    if (condition.trial === "later") {
      const session = [...currentSessions][0];
      need(!sessions.has(session));
      sessions.add(session);
    }
    const rank = condition.phase === "explore" ? 19 : 95;
    samples.sort((a, b) => a - b);
    apiSamples.sort((a, b) => a - b);
    need(
      samples.filter((value) => value <= 15000).length >= rank &&
        samples[rank - 1] <= 15000 &&
        apiSamples.filter((value) => value <= 15000).length >= rank &&
        apiSamples[rank - 1] <= 15000
    );
    result.push({
      id: condition.id,
      scenarioId: scenario.id,
      routing: condition.routing,
      phase: condition.phase,
      trial: condition.trial,
      attempts: count,
      rank,
      p95PageMS: samples[rank - 1],
      p95ApiMS: apiSamples[rank - 1],
    });
  }
  budget.metrics.releaseTimingRecords = {
    bytes: footprint.bytes,
    allocatedBytes: footprint.allocated,
    files: footprint.physical.size,
  };
  return { timings: result, allocatedBytes: footprint.allocated };
}
module.exports = { verifySeries };
