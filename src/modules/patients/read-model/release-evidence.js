// Concrete reviewed observation schemas. Trust comes from the independently
// installed reviewer and exact approved bytes, not from fields named "passed".
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { CATEGORIES } = require("./schema");
const { digest } = require("./capacity");
const BASELINE = "0a1934df24b1b66a2edbe2cb3e8235a7073932a7";
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const COVERAGE = [
  "date-ranges",
  "date-boundaries",
  "graph-periods",
  "geographic-scope",
  "filter-presence-and-types",
  "cid-reuse",
  "card-calculations",
  "bar-calculations",
  "disease-total",
  "dm-ca-other",
  "empty-and-sparse-data",
  "stored-snapshots",
  "errors",
  "response-shape-and-order",
  "typed-bson-collation",
  "all-fifteen-bindings",
  "independent-card-services-and-hospitals",
  "exact-expense-policy",
  "snapshot-source-provenance",
  "full-raw-corrections-and-deletions",
  "same-cut-recovery",
  "concurrent-generation-lifetime",
  "full-target-workload",
  "actual-page-and-visible-freshness",
];
const GATES = [
  "source",
  "correctness",
  "native",
  "capacity",
  "full-workload",
  "page",
  "freshness",
  "frontend",
  "operations",
];
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const same = isDeepStrictEqual;

function verifyObservations(manifest, policy, { capacityPolicy, capacityKey, mongo, topology }) {
  const fail = (name) => {
    const error = new Error("Release observations unavailable");
    error.releaseReason = `release-gate-${name}`;
    throw error;
  };
  const need = (condition, gate) => {
    if (!condition) fail(gate);
  };
  const covers = (actual, expected) =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value));
  const witnessed = (name) => {
    const gate = manifest.gates?.[name];
    need(
      gate?.schema === `patients-release-${name}-v1` &&
        sha(gate.artifactSha256) &&
        Array.isArray(gate.failures) &&
        gate.failures.length === 0 &&
        Array.isArray(gate.unverified) &&
        gate.unverified.length === 0 &&
        gate.observations &&
        typeof gate.observations === "object",
      name
    );
    return gate.observations;
  };
  need(covers(Object.keys(manifest.gates ?? {}), GATES), "inventory");
  const deployment = manifest.deployment;
  need(
    same(deployment, policy.deployment) &&
      typeof deployment?.id === "string" &&
      deployment.id.length <= 128 &&
      typeof deployment.revision === "string" &&
      deployment.revision.length <= 128 &&
      typeof deployment.environment === "string" &&
      sha(deployment.configSha256) &&
      sha(deployment.referenceSha256) &&
      typeof deployment.frontendRevision === "string" &&
      deployment.frontendRevision.length > 0,
    "deployment"
  );
  const descriptors = manifest.descriptors;
  const first = descriptors[0].source;

  const source = witnessed("source");
  need(Array.isArray(source.sources) && source.sources.length === descriptors.length, "source");
  for (const descriptor of descriptors) {
    const expected = descriptor.source;
    const observed = source.sources.find((value) => value.sha256 === expected.sha256);
    need(
      observed &&
        observed.transportSha256 === expected.sha256 &&
        observed.sourceVersion === expected.sourceVersion &&
        same(observed.domain, expected.domain) &&
        same(observed.history, expected.history) &&
        observed.records === expected.records &&
        observed.dataset === "raw" &&
        observed.consistency === "producer-sealed-full-export" &&
        Number.isFinite(Date.parse(observed.availableAt)) &&
        finite(observed.maximumUpstreamDelayMS),
      "source"
    );
  }

  const correctness = witnessed("correctness");
  need(
    correctness.baselineRevision === BASELINE &&
      correctness.referenceSha256 === deployment.referenceSha256 &&
      correctness.repeatedReferenceSha256 === deployment.referenceSha256 &&
      correctness.sourceSha256 === first.sha256 &&
      correctness.comparison === "exact-status-headers-types-presence-array-order-approved-expense-503-metadata" &&
      covers(correctness.coverage, COVERAGE) &&
      Array.isArray(correctness.cases) &&
      correctness.cases.length >= COVERAGE.length &&
      correctness.cases.length <= 512,
    "correctness"
  );
  for (const family of COVERAGE)
    need(
      correctness.cases.some((value) => value.family === family),
      "correctness"
    );
  for (const test of correctness.cases) {
    need(
      sha(test.requestSha256) &&
        Number.isFinite(Date.parse(test.clock)) &&
        typeof test.timeZone === "string" &&
        Array.isArray(test.responses) &&
        test.responses.length === 6,
      "correctness"
    );
    new Intl.DateTimeFormat("en", { timeZone: test.timeZone }).format();
    test.responses.forEach((response, i) =>
      need(
        response.route === ROUTES[i] &&
          Number.isInteger(response.expectedStatus) &&
          response.expectedStatus === response.actualStatus &&
          sha(response.expectedBodySha256) &&
          response.expectedBodySha256 === response.actualBodySha256 &&
          sha(response.expectedHeadersSha256) &&
          response.expectedHeadersSha256 === response.actualHeadersSha256,
        "correctness"
      )
    );
  }

  const native = witnessed("native");
  const runtime = Object.fromEntries(
    ["node", "platform", "arch", "driver", "codec"].map((name) => [name, manifest.subject[name]])
  );
  const golden = createHash("sha256")
    .update(Buffer.from("3a300000020000000000010001000000180000001c000000000001000000", "hex"))
    .digest("hex");
  const processInventory = digest({ processes: capacityPolicy.topology.processes });
  need(
    same(native.runtime, runtime) &&
      native.mongoVersion === mongo.version &&
      native.topologySha256 === digest(topology) &&
      native.goldenSha256 === golden &&
      native.processInventorySha256 === processInventory &&
      native.termination === "registered-worker-and-independent-database-proof",
    "native"
  );

  const capacity = witnessed("capacity");
  need(
    capacity.policyKey === capacityKey &&
      capacity.coverage === "complete-peak" &&
      capacity.responseAttribution === "isolated-response" &&
      capacity.physicalSharing === "deduplicated" &&
      Array.isArray(capacity.domains) &&
      capacity.domains.length === capacityPolicy.domains.length &&
      covers(capacity.purposes, [
        "source",
        "collections",
        "indexes",
        "staging",
        "spill",
        "logs",
        "retry",
        "retained-generations",
        "control",
        "reports",
      ]) &&
      covers(capacity.concurrent, ["serving", "refresh", "recovery"]),
    "capacity"
  );
  const caps = {
    responseBytes: 128 * 1048576,
    apiBytes: 256 * 1048576,
    builderBytes: 512 * 1048576,
    serializedBytes: 8 * 1048576,
    chunkBytes: 1048576,
    payloadBytes: 960 * 1024,
  };
  for (const [name, maximum] of Object.entries(caps))
    need(
      integer(capacity.fixedBudgets?.[name]) &&
        capacity.fixedBudgets[name] > 0 &&
        capacity.fixedBudgets[name] <= maximum,
      "capacity"
    );
  function headroom(value, installed) {
    need(
      value &&
        ["allocation", "totalLimit", "existingPeak", "reservations"].every(
          (key) => finite(value[key]) && value[key] === installed[key]
        ),
      "capacity"
    );
    const h = Math.min(value.allocation, value.totalLimit) - value.existingPeak - value.reservations;
    need(h > 0, "capacity");
    return h;
  }
  function additional(value, limit) {
    need(
      finite(value.additional) &&
        finite(value.total) &&
        value.additional <= limit &&
        value.total >= value.additional &&
        value.total <= Math.min(value.allocation, value.totalLimit),
      "capacity"
    );
  }
  for (const installed of capacityPolicy.domains) {
    const domain = capacity.domains.find((value) => value.id === installed.id);
    need(domain, "capacity");
    if (installed.ram) {
      const ram = domain.ram,
        h = headroom(ram, installed.ram);
      need(
        ["response", "api", "builder", "database", "combined", "total"].every((key) => finite(ram[key])) &&
          ram.response <= capacity.fixedBudgets.responseBytes &&
          ram.api >= ram.response &&
          ram.api <= Math.min(capacity.fixedBudgets.apiBytes, h / 4) &&
          ram.builder <= Math.min(capacity.fixedBudgets.builderBytes, h / 4) &&
          ram.database <= h / 4 &&
          ram.combined <= (3 * h) / 4 &&
          ram.combined >= Math.max(ram.api, ram.builder, ram.database) &&
          ram.total >= ram.combined &&
          ram.total <= Math.min(ram.allocation, ram.totalLimit),
        "capacity"
      );
    }
    if (installed.disk) additional(domain.disk, headroom(domain.disk, installed.disk) * 0.8);
    if (installed.cpu) {
      additional(domain.cpu, headroom(domain.cpu, installed.cpu) * 0.5);
      need(domain.cpu.unit === installed.cpu.unit && domain.cpu.windowMS === installed.cpu.windowMS, "capacity");
    }
    need(Array.isArray(domain.io) && domain.io.length === installed.io.length, "capacity");
    for (const metric of installed.io) {
      const value = domain.io.find((value) => value.id === metric.id);
      additional(value, headroom(value, metric) * 0.5);
      need(value.unit === metric.unit && value.windowMS === metric.windowMS, "capacity");
    }
  }

  const workload = witnessed("full-workload");
  need(
    workload.sourceSha256 === first.sha256 &&
      same(workload.domain, first.domain) &&
      same(workload.history, first.history) &&
      workload.rawRecords === first.records &&
      covers(workload.coverage, COVERAGE) &&
      Array.isArray(workload.categories) &&
      workload.categories.length === 15 &&
      Array.isArray(workload.occupiedGenerationBytes) &&
      workload.occupiedGenerationBytes.length === 2 &&
      workload.occupiedGenerationBytes.every((value) => integer(value) && value > 0) &&
      workload.occupiedGenerationBytes[0] !== workload.occupiedGenerationBytes[1],
    "full-workload"
  );
  CATEGORIES.forEach(({ id }, i) =>
    need(
      workload.categories[i].id === id &&
        integer(workload.categories[i].memberships) &&
        integer(workload.categories[i].bytes),
      "full-workload"
    )
  );
  for (const field of [
    "typedIdentities",
    "hospitalDays",
    "historicalGeographies",
    "partitions",
    "scopes",
    "dateMonths",
    "storedMonths",
    "dictionaryBytes",
    "indexBytes",
    "bitmapBytes",
    "largestPartitionBytes",
    "largestUnionBytes",
  ])
    need(integer(workload.cardinalities?.[field]), "full-workload");

  const page = witnessed("page");
  need(
    page.frontendRevision === deployment.frontendRevision &&
      page.referenceSha256 === deployment.referenceSha256 &&
      page.timing === "initiating-action-to-current-six-render" &&
      Number.isFinite(Date.parse(page.calculationClock)) &&
      page.timeZone === manifest.subject.timeZone &&
      covers(page.coverage, COVERAGE) &&
      Array.isArray(page.conditions) &&
      page.conditions.length >= 2 &&
      page.conditions.length <= 512 &&
      ["first", "later"].every((trial) => page.conditions.some((value) => value.trial === trial)),
    "page"
  );
  const timings = [];
  for (const condition of page.conditions) {
    need(
      ["first", "later"].includes(condition.trial) &&
        sha(condition.requestSha256) &&
        Array.isArray(condition.warmups) &&
        condition.warmups.length === (condition.trial === "first" ? 0 : 5) &&
        condition.warmups.every(
          (value) => finite(value.elapsedMS) && value.errors === 0 && value.currentResults === 6
        ) &&
        Array.isArray(condition.attempts) &&
        condition.attempts.length === 100 &&
        new Set(condition.attempts.map((value) => value.id)).size === 100,
      "page"
    );
    const reference = correctness.cases.find((value) => value.requestSha256 === condition.requestSha256);
    need(reference, "page");
    if (condition.trial === "first")
      need(new Set(condition.attempts.map((value) => value.session)).size === 100, "page");
    else
      need(
        new Set([...condition.attempts, ...condition.warmups].map((value) => value.session)).size === 1 &&
          condition.warmups.every((value) => value.referenceSha256 === deployment.referenceSha256),
        "page"
      );
    const apiSamples = [];
    const samples = condition.attempts
      .map((value) => {
        const api = value.api;
        need(
          api &&
            integer(api.commandsStarted) &&
            api.commandsStarted > 0 &&
            api.commandsStarted === api.commandsSettled &&
            api.activeCommands === 0 &&
            integer(api.queryErrors) &&
            api.overflow === 0 &&
            api.proof === "reader-shared-renewals-http-and-capacity-settled",
          "page"
        );
        const correct =
          typeof value.session === "string" &&
          value.session.length > 0 &&
          integer(value.actionAt) &&
          integer(value.apiCompletedAt) &&
          integer(value.renderedAt) &&
          value.apiCompletedAt >= value.actionAt &&
          value.renderedAt >= value.apiCompletedAt &&
          value.errors === 0 &&
          api.queryErrors === 0 &&
          Array.isArray(value.responses) &&
          value.responses.length === 6 &&
          value.responses.every(
            (response, i) =>
              response.route === ROUTES[i] &&
              response.status === 200 &&
              response.bodySha256 === reference.responses[i].expectedBodySha256 &&
              response.headersSha256 === reference.responses[i].expectedHeadersSha256 &&
              integer(response.parsedAt) &&
              response.parsedAt >= value.actionAt &&
              response.parsedAt <= value.apiCompletedAt &&
              response.renderedForCurrentLoad === true
          );
        apiSamples.push(correct ? value.apiCompletedAt - value.actionAt : Infinity);
        return correct ? value.renderedAt - value.actionAt : Infinity;
      })
      .sort((a, b) => a - b);
    need(samples.filter((value) => value <= 15000).length >= 95 && samples[94] <= 15000, "page");
    apiSamples.sort((a, b) => a - b);
    need(apiSamples.filter((value) => value <= 15000).length >= 95 && apiSamples[94] <= 15000, "page");
    timings.push({ id: condition.id, attempts: 100, rank: 95, p95PageMS: samples[94], p95ApiMS: apiSamples[94] });
  }

  const fresh = witnessed("freshness");
  const chain = [
    "mutationAvailableAt",
    "cutAt",
    "exportCompletedAt",
    "acquisitionCompletedAt",
    "buildStartedAt",
    "buildCompletedAt",
    "publishedAt",
    "readAt",
    "displayedAt",
  ];
  need(
    fresh.sourceSha256 === first.sha256 &&
      fresh.recoveredSourceSha256 === first.sha256 &&
      fresh.cutAt === Date.parse(first.sourceCutAt) &&
      chain.every((key) => integer(fresh[key])) &&
      chain.every((key, i) => i === 0 || fresh[key] >= fresh[chain[i - 1]]) &&
      integer(fresh.previousCutAt) &&
      fresh.cutAt - fresh.previousCutAt <= 12 * 3600000 &&
      fresh.cutAt >= fresh.previousCutAt &&
      fresh.cutAt - fresh.mutationAvailableAt <= 12 * 3600000 &&
      fresh.acquisitionCompletedAt - fresh.cutAt <= 2 * 3600000 &&
      fresh.buildCompletedAt - fresh.buildStartedAt <= 6 * 3600000 &&
      fresh.displayedAt - fresh.mutationAvailableAt <= 24 * 3600000 &&
      ["coordinationMS", "cleanupMS", "recoveryMS"].every((key) => finite(fresh[key])) &&
      fresh.coordinationMS + fresh.cleanupMS + fresh.recoveryMS <= 4 * 3600000 &&
      integer(fresh.cleanupCompletedAt) &&
      fresh.cleanupCompletedAt >= fresh.publishedAt &&
      fresh.recovery === "same-cut-same-run-fixed-ledger" &&
      fresh.termination === "registered-worker-and-independent-database-proof",
    "freshness"
  );

  const frontend = witnessed("frontend");
  need(
    frontend.revision === deployment.frontendRevision &&
      covers(frontend.observations, [
        "source-time-rendered",
        "stale-rendered",
        "unknown-rendered",
        "503-without-current-zeros",
        "rapid-filter-current-six-only",
        "atomic-six-result-replacement",
      ]),
    "frontend"
  );
  const operations = witnessed("operations");
  need(
    operations.deploymentRevision === deployment.revision &&
      operations.processInventorySha256 === processInventory &&
      same(operations.schedules, ["11:00", "23:00"]) &&
      operations.timeZone === "Asia/Bangkok" &&
      same(operations.budgetHours, [12, 2, 6, 4]) &&
      operations.maximumHeavy === 1 &&
      operations.maximumBuilders === 1 &&
      [operations.maximumSlots, operations.maximumPins, operations.maximumControlBytes].every(
        (value) => integer(value) && value > 0
      ) &&
      operations.maximumSlots <= 2 &&
      operations.maximumPins <= 64 &&
      operations.maximumControlBytes <= 1048576 &&
      operations.requestDeadlineMS === 60000 &&
      covers(operations.observations, [
        "six-mode-consistent",
        "optimized-failure-503",
        "retained-compatible-rollback",
        "legacy-selector-rollback",
        "cleanup-deletion-exclusion",
        "source-job-frontend-deployment-handoffs",
      ]),
    "operations"
  );
  return {
    timings,
    gates: GATES.map((name) => ({
      name,
      state: manifest.scope === "deployment" ? "verified" : "schema-exercised-only",
      artifactSha256: manifest.gates[name].artifactSha256,
    })),
  };
}

module.exports = { verifyObservations };
