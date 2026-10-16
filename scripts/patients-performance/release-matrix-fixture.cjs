// Synthetic page/telemetry protocol records, never measured target trials.
// Concrete requests and clocks come from the separately captured baseline.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { digest } = require("../../src/modules/patients/read-model/capacity");
const { createFixture, PARTS } = require("./contract-fixture.cjs");
const reference = require("./references/legacy-six-endpoints.json");
let cached;
function timingMatrix() {
  if (cached) return structuredClone(cached);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-release-records-"));
  process.once("exit", () => fs.rmSync(directory, { recursive: true, force: true }));
  const cases = [],
    scenarios = [],
    conditions = [],
    negativeComparisons = [];
  const dictionaries = new Map(),
    identities = new Map();
  const inputs = createFixture().cases;
  const extras = {
    "typed-identity-equivalence": ["typed-bson-collation"],
    "arithmetic-overlap": ["independent-card-services-and-hospitals"],
    "expense-ties": ["exact-expense-policy"],
    "snapshot-valid": ["snapshot-source-provenance"],
  };
  const contexts = [
    [
      "full-history-correction-and-deletion",
      "national-longest",
      "full-raw-corrections-and-deletions",
      { operation: "replace-and-delete", history: "complete" },
    ],
    [
      "same-cut-build-resume",
      "national-longest",
      "same-cut-recovery",
      { operation: "resume", sourceCut: "unchanged", ledger: "original-12-2-6-4" },
    ],
    [
      "pinned-reader-during-publication",
      "snapshot-valid",
      "concurrent-generation-lifetime",
      { operation: "publish-next-generation", reader: "prior-generation-pinned" },
    ],
    [
      "full-domain-two-generations",
      "national-longest",
      "full-target-workload",
      { operation: "full-domain", generations: 2 },
    ],
    [
      "rapid-filter-current-six-with-source-time",
      "province",
      "actual-page-and-visible-freshness",
      { operation: "rapid-filter", display: "current-six-and-source-time" },
    ],
    [
      "all-fifteen-independent-bindings",
      "arithmetic-overlap",
      "all-fifteen-bindings",
      { operation: "independent-category-reference", categories: 15 },
    ],
  ];
  const supplied = inputs.map((item) => ({ ...item, context: { variant: item.variant, fault: item.fault ?? null } }));
  for (const [id, original, family, context] of contexts) {
    const input = inputs.find((item) => item.id === original);
    supplied.push({
      ...input,
      id,
      referenceId: original,
      families: [family, "response-shape-and-order"],
      context: { variant: input.variant, fault: input.fault ?? null, ...context },
    });
  }
  const receipt = {
    commandsStarted: 6,
    commandsSettled: 6,
    activeCommands: 0,
    queryErrors: 0,
    overflow: 0,
    proof: "reader-shared-renewals-http-and-capacity-settled",
  };
  for (const input of supplied) {
    const captured = reference.cases.find((item) => item.id === (input.referenceId ?? input.id));
    const requestBytes = JSON.stringify(input.body),
      requestSha256 = createHash("sha256").update(requestBytes).digest("hex");
    const contextBytes = JSON.stringify(input.context),
      contextSha256 = createHash("sha256").update(contextBytes).digest("hex");
    const identity = digest({ requestSha256, clock: input.clock, timeZone: input.timeZone, contextSha256 });
    const families = [
      ...new Set([...input.families.filter((family) => family !== "fixed-fixture"), ...(extras[input.id] ?? [])]),
    ];
    if (identities.has(identity)) {
      const previous = identities.get(identity);
      previous.test.families = [...new Set([...previous.test.families, ...families])];
      previous.scenario.families = previous.test.families;
      previous.scenario.aliases.push(input.id);
      continue;
    }
    const responses = PARTS.map(({ id, route }) => {
      const original = captured.responses[id];
      const failed = original.status !== 200 || original.body?.status === false || original.queryErrors.length > 0;
      const status = failed ? 503 : original.status;
      const body = failed ? { status: false, message: "Read model unavailable" } : original.body;
      return {
        route,
        expectedStatus: status,
        actualStatus: status,
        expectedBodySha256: digest({ value: body }),
        actualBodySha256: digest({ value: body }),
        expectedHeadersSha256: digest({ value: original.headers }),
        actualHeadersSha256: digest({ value: original.headers }),
      };
    });
    const responsesSha256 = digest({ values: responses });
    dictionaries.set(responsesSha256, responses);
    const test = {
      id: input.id,
      families,
      requestSha256,
      contextSha256,
      clock: input.clock,
      timeZone: input.timeZone,
      responsesSha256,
    };
    const referenceSha256 = digest({
      clock: input.clock,
      timeZone: input.timeZone,
      contextSha256,
      responses: responses.map((row) => ({
        route: row.route,
        status: row.expectedStatus,
        bodySha256: row.expectedBodySha256,
        headersSha256: row.expectedHeadersSha256,
      })),
    });
    const fields = ["area", "province", "district", "hcode"],
      body = input.body;
    const graph = fields.every((field) => body[field] === "");
    const range =
      body.startDate == "2024-01-07" &&
      body.endDate == new Date(input.clock).toISOString().slice(0, 10) &&
      fields.every((field) => body[field] == "");
    const routing = graph === range ? (graph ? "snapshot" : "live") : "mixed";
    const scenario = {
      id: input.id,
      aliases: [],
      families,
      requestBytes,
      requestSha256,
      contextBytes,
      contextSha256,
      referenceSha256,
      routing,
    };
    identities.set(identity, { test, scenario });
    cases.push(test);
    scenarios.push(scenario);
    if (responses.some((row) => row.expectedStatus !== 200)) {
      negativeComparisons.push({ scenarioId: input.id, requestSha256, referenceSha256, responsesSha256 });
      continue;
    }
    const values = responses.map((row) => ({
      route: row.route,
      status: row.expectedStatus,
      bodySha256: row.expectedBodySha256,
      headersSha256: row.expectedHeadersSha256,
    }));
    const dictionarySha256 = responsesSha256;
    for (const phase of ["explore", "acceptance"])
      for (const trial of ["first", "later"]) {
        const id = `c${conditions.length}`,
          count = phase === "explore" ? 20 : 100;
        const make = (n, kind) => ({
          id: `${kind[0]}${n}`,
          kind,
          session: trial === "first" ? `${id}:${n}` : id,
          actionAt: n * 1000,
          apiCompletedAt: n * 1000 + 5,
          renderedAt: n * 1000 + 10,
          errors: 0,
          api: receipt,
          responses: PARTS.map((_, index) => [index, 5, 1]),
        });
        const warmups = trial === "later" ? Array.from({ length: 5 }, (_, n) => make(n, "warmup")) : [];
        const attempts = Array.from({ length: count }, (_, n) => make(n, "attempt"));
        const condition = {
          id,
          scenarioId: input.id,
          phase,
          trial,
          routing,
          responseDictionarySha256: dictionarySha256,
        };
        if (!conditions.length)
          Object.assign(condition, {
            warmups,
            attempts: attempts.map((row) => ({
              ...row,
              responses: values.map((value) => ({
                ...value,
                parsedAt: row.apiCompletedAt,
                renderedForCurrentLoad: true,
              })),
            })),
          });
        else {
          const binding = {
            kind: "binding",
            conditionId: id,
            scenarioId: input.id,
            requestSha256,
            referenceSha256,
            routing,
            phase,
            trial,
          };
          const compact = (row) => [
            row.kind === "warmup" ? 0 : 1,
            row.id,
            row.session,
            row.actionAt,
            row.apiCompletedAt,
            row.renderedAt,
            row.errors,
            0,
            row.responses,
          ];
          const bytes = Buffer.from(
            [binding, ...warmups.map(compact), ...attempts.map(compact)]
              .map((row) => JSON.stringify(row) + "\n")
              .join("")
          );
          const sha256 = createHash("sha256").update(bytes).digest("hex"),
            filename = `series-${sha256}.ndjson`;
          fs.writeFileSync(path.join(directory, filename), bytes);
          condition.series = { filename, sha256, bytes: bytes.length, records: count + warmups.length + 1 };
        }
        conditions.push(condition);
      }
  }
  const totalBytes = conditions.reduce((sum, row) => sum + (row.series?.bytes ?? 0), 0);
  if (totalBytes > 8 * 1048576) throw new Error("Synthetic record allowance exceeded");
  const allocatedBytes = fs.readdirSync(directory).reduce((sum, name) => {
    const stat = fs.statSync(path.join(directory, name));
    return sum + Math.max(stat.size, stat.blocks * 512);
  }, 0);
  cached = {
    allocatedBytes,
    directory,
    cases,
    scenarios,
    conditions,
    negativeComparisons,
    correctnessDictionaries: [...dictionaries].map(([sha256, values]) => ({ sha256, values })),
    apiReceipts: [receipt],
    totalBytes,
  };
  return structuredClone(cached);
}
function changeTimingSeries(draft, select, change) {
  const condition = draft.gates.page.observations.conditions.find(
    (row) => row.phase === select.phase && row.trial === select.trial && row.series
  );
  const series = condition.series,
    directory = timingMatrix().directory;
  const rows = fs
    .readFileSync(path.join(directory, series.filename), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  change(rows);
  const bytes = Buffer.from(rows.map((row) => JSON.stringify(row) + "\n").join(""));
  const sha256 = createHash("sha256").update(bytes).digest("hex"),
    filename = `series-${sha256}.ndjson`;
  fs.writeFileSync(path.join(directory, filename), bytes);
  condition.series = { filename, sha256, bytes: bytes.length, records: rows.length };
}
module.exports = { timingMatrix, changeTimingSeries };
