const { createHash } = require("node:crypto");
const { performance: monotonicClock } = require("node:perf_hooks");
const { PARTS } = require("./contract-fixture.cjs");

const LIMITS = Object.freeze({ activeCommands: 256, errors: 128, bytes: 256 * 1024 });
const NAMES = new Set([
  "find",
  "aggregate",
  "getMore",
  "killCursors",
  "update",
  "insert",
  "delete",
  "findAndModify",
  "count",
  "distinct",
  "create",
  "createIndexes",
  "listIndexes",
  "listCollections",
  "drop",
  "collStats",
  "endSessions",
  "ping",
]);
const ERRORS = new Set([
  "MongoServerError",
  "MongoWriteConcernError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongoOperationTimeoutError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
  "MongoClientClosedError",
  "MongoRuntimeError",
  "MongoInvalidArgumentError",
]);
const diagnostic = (error) => ({
  name: ERRORS.has(error?.name) ? error.name : "UnclassifiedDatabaseError",
  code: Number.isSafeInteger(error?.code)
    ? error.code
    : typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code)
      ? error.code
      : null,
  sanitized: !ERRORS.has(error?.name),
});

// Command monitoring is real driver evidence. It is sealed only after the
// independent Reader/HTTP ownership handoff ends, never from a quiet key map.
function commandTrace(client) {
  const pending = new Map();
  let active,
    blocked = false,
    preflightCommands = 0,
    wake;
  const changed = () => {
    wake?.();
    wake = undefined;
  };
  const key = (event) =>
    createHash("sha256")
      .update(`${String(event.connectionId)}:${String(event.serviceId ?? "")}:${event.requestId}`)
      .digest("hex");
  function violation(trace, reason) {
    blocked = true;
    if (trace && !trace.violations.includes(reason) && trace.violations.length < 16) trace.violations.push(reason);
  }
  function failure(trace, command, error, kind = "commandFailed") {
    if (!trace) {
      violation(active, "database-error-outside-owned-load");
      return;
    }
    trace.errorCount += 1;
    if (trace.queryErrors.length < LIMITS.errors) trace.queryErrors.push({ command, kind, ...diagnostic(error) });
    else {
      trace.errorOverflow += 1;
      violation(trace, "database-error-evidence-overflow");
    }
  }
  client.on("commandStarted", (event) => {
    const command = NAMES.has(event.commandName) ? event.commandName : "other";
    const trace = active;
    if (trace) {
      trace.commandsStarted += 1;
      trace.commandCounts[command] = (trace.commandCounts[command] ?? 0) + 1;
      if (command === "other") violation(trace, "unclassified-command");
    } else preflightCommands += 1;
    const identity = key(event);
    if (pending.size >= LIMITS.activeCommands || pending.has(identity)) {
      violation(trace, "active-command-evidence-overflow-or-duplicate");
    } else pending.set(identity, { trace, command, started: monotonicClock.now() });
    changed();
  });
  const terminal = (event, failed) => {
    const operation = pending.get(key(event));
    if (!operation) {
      violation(active, "terminal-command-without-start");
      changed();
      return;
    }
    pending.delete(key(event));
    const trace = operation.trace;
    if (trace) {
      trace.commandsSettled += 1;
      trace.commandDurationMS += monotonicClock.now() - operation.started;
      if (trace !== active) violation(active, "late-command-after-seal");
      if (failed) failure(trace, operation.command, event.failure);
      else {
        for (const error of event.reply?.writeErrors ?? [])
          failure(trace, operation.command, { ...error, name: "MongoServerError" }, "writeError");
        if (event.reply?.writeConcernError)
          failure(
            trace,
            operation.command,
            { ...event.reply.writeConcernError, name: "MongoWriteConcernError" },
            "writeConcernError"
          );
      }
    } else if (failed) failure(active, operation.command, event.failure);
    changed();
  };
  client.on("commandSucceeded", (event) => terminal(event, false));
  client.on("commandFailed", (event) => terminal(event, true));
  return {
    begin(id) {
      if (active || blocked || pending.size) throw new Error("Previous load or database evidence is unresolved");
      active = {
        id,
        commandsStarted: 0,
        commandsSettled: 0,
        commandCounts: {},
        commandDurationMS: 0,
        queryErrors: [],
        errorCount: 0,
        errorOverflow: 0,
        violations: [],
        requests: new Map(),
      };
      return { id, preflightCommands, limits: LIMITS };
    },
    response(route, res) {
      const trace = active;
      if (!trace) return undefined;
      if (!PARTS.some((part) => part.route === route) || trace.requests.has(route)) {
        violation(trace, "unexpected-or-duplicate-http-route");
        return undefined;
      }
      const request = { route, httpEnded: false, proof: null };
      trace.requests.set(route, request);
      for (const event of ["finish", "close"])
        res.once(event, () => {
          request.httpEnded = true;
          changed();
        });
      const complete = (proof) => {
        if (request.proof) {
          violation(trace, "duplicate-dependency-settlement");
          return;
        }
        request.proof = {
          safe: proof?.safe === true,
          proof:
            typeof proof?.proof === "string" && /^[a-z-]{1,96}$/.test(proof.proof)
              ? proof.proof
              : "unspecified-settlement",
        };
        const identity = proof?.capacity;
        if (identity)
          request.capacity = {
            generationId: /^[a-f0-9-]{36}$/.test(identity.generationId) ? identity.generationId : null,
            policyKey:
              identity.policyKey === "unverified" || /^[a-f0-9]{64}$/.test(identity.policyKey)
                ? identity.policyKey
                : null,
            scope: ["isolated-fixture", "deployment", "unverified"].includes(identity.scope) ? identity.scope : null,
          };
        changed();
      };
      complete.error = (error) => {
        if (typeof error?.name === "string" && error.name.startsWith("Mongo"))
          failure(trace, "operation", error, "operationError");
      };
      return complete;
    },
    async seal(id, timeoutMS) {
      if (!active || active.id !== id) throw new Error("Unknown active load");
      const trace = active,
        deadline = monotonicClock.now() + timeoutMS;
      const settled = () =>
        trace.requests.size === PARTS.length &&
        [...trace.requests.values()].every((request) => request.httpEnded && request.proof);
      while (!settled() && monotonicClock.now() < deadline) {
        let timer;
        try {
          await Promise.race([
            new Promise((resolve) => {
              wake = resolve;
            }),
            new Promise((resolve) => {
              timer = setTimeout(resolve, Math.max(1, deadline - monotonicClock.now()));
            }),
          ]);
        } finally {
          clearTimeout(timer);
          wake = undefined;
        }
      }
      const safe =
        settled() && [...trace.requests.values()].every((request) => request.proof.safe) && pending.size === 0;
      const value = {
        id,
        commandsStarted: trace.commandsStarted,
        commandsSettled: trace.commandsSettled,
        commandCounts: trace.commandCounts,
        commandDurationMS: trace.commandDurationMS,
        queryErrors: trace.queryErrors,
        errorCount: trace.errorCount,
        errorOverflow: trace.errorOverflow,
        violations: trace.violations,
        activeCommands: pending.size,
        requests: [...trace.requests.values()],
        limits: LIMITS,
        settlement: {
          safe,
          proof: safe ? "reader-shared-renewals-http-and-capacity-settled" : "dependent-work-unverified",
        },
      };
      value.errorEvidenceVerified =
        safe && !trace.violations.length && !trace.errorOverflow && trace.commandsStarted === trace.commandsSettled;
      if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.bytes) {
        violation(trace, "encoded-telemetry-overflow");
        value.errorEvidenceVerified = false;
      }
      if (safe) active = undefined;
      return value;
    },
    get unresolved() {
      return !!active || pending.size > 0;
    },
  };
}
module.exports = { commandTrace, LIMITS };
