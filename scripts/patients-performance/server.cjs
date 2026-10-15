const { AsyncLocalStorage } = require("node:async_hooks");
const { createHash, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const path = require("node:path");
const { performance: monotonicClock } = require("node:perf_hooks");
const express = require("express");

const NativeDate = Date;
const requestStorage = new AsyncLocalStorage();
const DEFAULT_SOURCE_ROOT = path.resolve(__dirname, "../../src");
const SUMMARY_COLLECTION = "NCD_SUMMARY";
const SNAPSHOT_COLLECTION = "NCD_Summary_Temp_Table";
const ROUTES = [
  ["/card", "modules/card-summary/card.controller.js", "cardController"],
  ["/bar-chart-pt", "modules/bar-chart/patients/chart-pt.controller.js", "chartPatientController"],
  ["/bar-chart-ex", "modules/bar-chart/expense/chart-ex.controller.js", "chartExpenseController"],
  ["/graph-disease-pt", "modules/graph/disease-patients/disease-pt.controller.js", "diseasePatientController"],
  ["/graph-dm-pt", "modules/graph/dm-patients/dm-pt.controller.js", "dmPatientController"],
  ["/graph-ca-pt", "modules/graph/ca-patients/ca-pt.controller.js", "caPatientController"],
];
let activeHarness = false;

function normalizeCase({ clock, timeZone = "UTC", fault = null }) {
  const clockMs = new NativeDate(clock).getTime();
  if (clock === undefined || clock === null || !Number.isFinite(clockMs)) {
    throw new Error("A valid fixed calculation clock is required");
  }
  new Intl.DateTimeFormat("en", { timeZone }).format(new NativeDate(clockMs));
  if (![null, "aggregate", "controller"].includes(fault)) {
    throw new Error("Fault must be null, aggregate, or controller");
  }
  return { clockMs, clock: new NativeDate(clockMs).toISOString(), timeZone, fault };
}

// Only request calculation code sees this clock. MongoDB operations use the real
// wall clock, and elapsed measurements always use monotonicClock.now().
function CalculationDate(...args) {
  const context = requestStorage.getStore();
  const now = context?.pinClock ? context.case.clockMs : NativeDate.now();
  if (!new.target) return new NativeDate(now).toString();
  return Reflect.construct(NativeDate, args.length ? args : [now], new.target);
}
Object.setPrototypeOf(CalculationDate, NativeDate);
CalculationDate.prototype = NativeDate.prototype;
CalculationDate.now = () => {
  const context = requestStorage.getStore();
  return context?.pinClock ? context.case.clockMs : NativeDate.now();
};

function diagnosticError(error) {
  // Messages and stacks can contain connection strings or patient identifiers.
  // Keep only bounded diagnostic names and codes, never arbitrary error text.
  const name = error?.constructor?.name;
  const code = error?.code;
  return {
    name: typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error",
    ...(typeof code === "number" && Number.isFinite(code) ? { code } : {}),
    ...(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? { code } : {}),
  };
}

function canonical(value, shape = false) {
  if (value instanceof NativeDate) {
    return shape ? "<date>" : { $date: Number.isFinite(value.getTime()) ? value.toISOString() : "invalid" };
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item, shape));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], shape)])
    );
  }
  if (shape) return value === null ? "<null>" : `<${typeof value}>`;
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value === undefined) return { $undefined: true };
  return value;
}

function fingerprint(pipeline, shape = false) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(pipeline, shape)))
    .digest("hex");
}

function containsWriteStage(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => key === "$out" || key === "$merge" || containsWriteStage(child));
}

function publicTrace(trace) {
  const aggregations = trace.aggregations.map((item) => ({ ...item }));
  return {
    requestId: trace.requestId,
    method: trace.method,
    route: trace.route,
    clock: trace.case.clock,
    requestedTimeZone: trace.case.timeZone,
    effectiveTimeZone: trace.effectiveTimeZone,
    fault: trace.case.fault,
    statusCode: trace.statusCode,
    complete: trace.complete,
    processingMs: trace.processingMs,
    aggregations,
    queryErrors: aggregations
      .filter((item) => item.success === false)
      .map((item) => ({
        collection: item.collection,
        namespace: item.namespace,
        pipelineFingerprint: item.pipelineFingerprint,
        error: item.error,
      })),
    errorEvidenceVerified: trace.complete && aggregations.every((item) => typeof item.success === "boolean"),
    suppressedConsoleErrors: trace.consoleErrors.length,
    consoleErrors: trace.consoleErrors.map((item) => ({ ...item })),
  };
}

/**
 * Run the six baseline controllers against an already verified test database.
 * This seam intentionally does not import the application, environment,
 * migration routes, or Discord initialization. It never connects or writes.
 * One instance can run in a process because require.cache and TZ are global.
 */
async function startServer({
  db,
  clock,
  timeZone = "UTC",
  fault = null,
  aggregateMaxTimeMS,
  sourceRoot = DEFAULT_SOURCE_ROOT,
}) {
  const SOURCE_ROOT = require("node:fs").realpathSync(sourceRoot);
  const MONGO_MODULE = path.join(SOURCE_ROOT, "lib/mongo.js");
  const LOCAL_MODULES = [
    MONGO_MODULE,
    ...ROUTES.flatMap(([, filename]) => {
      const base = path.join(SOURCE_ROOT, filename.replace(".controller.js", ""));
      return ["controller", "service", "repository"].map((suffix) => `${base}.${suffix}.js`);
    }),
    path.join(SOURCE_ROOT, "modules/shared/count-cid.repository.js"),
    path.join(SOURCE_ROOT, "modules/patients/backend.js"),
    ...["ncd-summary", "temp-table", "temp-table-chart-pt"].map((name) => path.join(SOURCE_ROOT, `models/${name}.js`)),
  ];
  if (activeHarness) throw new Error("Only one Patients harness may run in this process");
  if (!db || typeof db.collection !== "function" || typeof db.databaseName !== "string" || !db.databaseName) {
    throw new Error("An explicit verified database with a databaseName and collection() is required");
  }
  if (aggregateMaxTimeMS !== undefined && (!Number.isInteger(aggregateMaxTimeMS) || aggregateMaxTimeMS <= 0)) {
    throw new Error("aggregateMaxTimeMS must be a positive integer when supplied");
  }
  let caseContext = normalizeCase({ clock, timeZone, fault });
  const originalTimeZone = process.env.TZ;
  const originalDate = global.Date;
  const originalConsoleError = console.error;
  const previousModules = new Map(LOCAL_MODULES.map((filename) => [filename, require.cache[filename]]));
  const traces = new Map();
  const pipelines = new Map();
  let activeRequests = 0;
  let activeQueries = 0;
  let closed = false;
  let server;

  function restore() {
    global.Date = originalDate;
    console.error = originalConsoleError;
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
    for (const [filename, previous] of previousModules) {
      delete require.cache[filename];
      if (previous) require.cache[filename] = previous;
    }
    activeHarness = false;
  }

  function withRealClock(callback) {
    const context = requestStorage.getStore();
    return context ? requestStorage.run({ ...context, pinClock: false }, callback) : callback();
  }

  const tracedDb = Object.freeze({
    databaseName: db.databaseName,
    collection(collectionName) {
      const collection = withRealClock(() => db.collection(collectionName));
      return Object.freeze({
        aggregate(pipeline, options) {
          const context = requestStorage.getStore();
          if (!context) throw new Error("An aggregation must belong to a traced HTTP request");
          if (!Array.isArray(pipeline) || containsWriteStage(pipeline)) {
            throw new Error("The Patients harness only permits read aggregation pipelines");
          }
          const started = monotonicClock.now();
          const effectiveOptions =
            aggregateMaxTimeMS === undefined ? options : { ...options, maxTimeMS: aggregateMaxTimeMS };
          const namespace = `${db.databaseName}.${collectionName}`;
          const source = collectionName === SNAPSHOT_COLLECTION ? "snapshot" : "live";
          const pipelineFingerprint = fingerprint(pipeline);
          const shapeFingerprint = fingerprint(pipeline, true);
          const stages = pipeline.map((stage) => Object.keys(stage).join(","));
          const key = `${namespace}:${pipelineFingerprint}`;
          if (!pipelines.has(key)) {
            pipelines.set(key, {
              id: key,
              collection: collectionName,
              namespace,
              source,
              pipelineFingerprint,
              shapeFingerprint,
              stages,
              pipeline: structuredClone(pipeline),
              ...(effectiveOptions === undefined ? {} : { options: structuredClone(effectiveOptions) }),
            });
          }
          const entry = {
            collection: collectionName,
            namespace,
            source,
            stages,
            pipelineFingerprint,
            shapeFingerprint,
            ...(effectiveOptions?.maxTimeMS === undefined ? {} : { maxTimeMS: effectiveOptions.maxTimeMS }),
            elapsedMs: null,
            success: null,
          };
          context.trace.aggregations.push(entry);
          activeQueries += 1;
          let settled = false;
          let executed = false;
          const settle = (success, error) => {
            if (settled) return;
            settled = true;
            activeQueries -= 1;
            entry.elapsedMs = monotonicClock.now() - started;
            entry.success = success;
            if (error) entry.error = diagnosticError(error);
          };
          let cursor;
          try {
            cursor = withRealClock(() => collection.aggregate(pipeline, effectiveOptions));
          } catch (error) {
            settle(false, error);
            throw error;
          }
          return Object.freeze({
            async toArray() {
              if (executed) throw new Error("Each traced aggregation cursor may be consumed once");
              executed = true;
              try {
                if (
                  context.case.fault === "controller" ||
                  (context.case.fault === "aggregate" && collectionName === SUMMARY_COLLECTION)
                ) {
                  const error = new Error("Injected Patients aggregation failure");
                  error.code = "PERF_INJECTED_AGGREGATE";
                  throw error;
                }
                const result = await withRealClock(() => cursor.toArray());
                settle(true);
                return result;
              } catch (error) {
                settle(false, error);
                throw error;
              }
            },
          });
        },
      });
    },
  });

  activeHarness = true;
  try {
    process.env.TZ = caseContext.timeZone;
    global.Date = CalculationDate;
    console.error = (...args) => {
      const context = requestStorage.getStore();
      if (!context) return originalConsoleError(...args);
      const error = args.find((item) => item instanceof Error);
      context.trace.consoleErrors.push(error ? diagnosticError(error) : { name: "ConsoleError" });
    };
    for (const filename of LOCAL_MODULES) delete require.cache[filename];
    require.cache[MONGO_MODULE] = {
      id: MONGO_MODULE,
      filename: MONGO_MODULE,
      loaded: true,
      exports: { db: tracedDb },
    };
    const app = express();
    app.disable("x-powered-by");
    app.use((req, res, next) => {
      const started = monotonicClock.now();
      const requestId = randomUUID();
      const trace = {
        requestId,
        method: req.method,
        route: req.path,
        case: caseContext,
        effectiveTimeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        statusCode: null,
        complete: false,
        processingMs: null,
        aggregations: [],
        consoleErrors: [],
      };
      traces.set(requestId, trace);
      activeRequests += 1;
      let finished = false;
      const finish = (complete) => {
        if (finished) return;
        finished = true;
        activeRequests -= 1;
        trace.statusCode = res.statusCode;
        trace.complete = complete;
        trace.processingMs = monotonicClock.now() - started;
      };
      res.setHeader("x-perf-request-id", requestId);
      res.once("finish", () => finish(true));
      res.once("close", () => finish(res.writableFinished));
      requestStorage.run({ trace, case: caseContext, pinClock: true }, next);
    });
    app.use(express.json());
    for (const [route, filename, exportName] of ROUTES) {
      const controller = require(path.join(SOURCE_ROOT, filename))[exportName];
      app.post(`/ncds_api/api/v1${route}`, (req, res, next) => {
        void Promise.resolve(controller(req, res)).catch(next);
      });
    }
    app.use((error, req, res, next) => {
      if (res.headersSent) return next(error);
      console.error(error);
      return res.status(500).json({ status: false, message: "Internal server error" });
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
  } catch (error) {
    if (server) server.close();
    restore();
    throw error;
  }

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    setCase(nextCase) {
      if (closed) throw new Error("The Patients harness is closed");
      if (activeRequests || activeQueries)
        throw new Error("Cannot change the case while requests or queries are active");
      const next = normalizeCase({
        clock: caseContext.clock,
        timeZone: caseContext.timeZone,
        fault: null,
        ...nextCase,
      });
      caseContext = next;
      process.env.TZ = next.timeZone;
      return { clock: next.clock, timeZone: next.timeZone, fault: next.fault };
    },
    getTrace(requestId) {
      const trace = traces.get(requestId);
      return trace ? publicTrace(trace) : undefined;
    },
    async waitForTrace(requestId, { timeoutMs = 30000 } = {}) {
      const deadline = monotonicClock.now() + timeoutMs;
      while (monotonicClock.now() <= deadline) {
        const trace = traces.get(requestId);
        if (!trace) throw new Error("Unknown Patients request ID");
        if (trace.processingMs !== null && trace.aggregations.every((item) => typeof item.success === "boolean")) {
          return publicTrace(trace);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Timed out waiting for Patients request evidence");
    },
    // Raw pipelines remain in memory for separately timed explain diagnostics.
    // Callers must not serialize them into result assets containing identifiers.
    getPipelines() {
      return [...pipelines.values()].map((item) => structuredClone(item));
    },
    clearTraces() {
      if (activeRequests || activeQueries) throw new Error("Cannot clear traces while requests or queries are active");
      traces.clear();
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      } finally {
        restore();
      }
    },
  };
}

module.exports = { startServer };
