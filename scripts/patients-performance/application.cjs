const { fork } = require("node:child_process");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { performance: monotonicClock } = require("node:perf_hooks");
const { PARTS } = require("./contract-fixture.cjs");
const HEADER_NAMES = [
  "content-type",
  "cache-control",
  "x-ncd-source-cut",
  "x-ncd-data-state",
  "access-control-expose-headers",
  "access-control-allow-origin",
  "vary",
  "etag",
];

async function startApplication({
  db,
  generationId,
  activeGeneration = false,
  sourceRoot = path.resolve(__dirname, "../../src"),
  clock = "2024-01-03T00:00:00.000Z",
  timeZone = "UTC",
  responseHeaders = {},
  transportUri,
  capacityFactory,
  backendMode = "legacy",
  releaseFactory,
  startupTimeoutMS = 20000,
  shutdownTimeoutMS = 3000,
}) {
  for (const value of [startupTimeoutMS, shutdownTimeoutMS])
    if (!Number.isInteger(value) || value < 1 || value > 60000) throw new Error("Invalid fixture lifecycle bound");
  sourceRoot = require("node:fs").realpathSync(sourceRoot);
  const uri = new URL(transportUri ?? process.env.PATIENTS_TEST_MONGO_URI);
  if (uri.hostname !== "127.0.0.1" || uri.username || uri.password || !db.databaseName.startsWith("patients_contract_"))
    throw new Error("Only isolated loopback fixture apps are allowed");
  uri.pathname = `/${db.databaseName}`;
  const child = fork(path.join(__dirname, "application-child.cjs"), [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    serialization: "advanced",
    env: {
      PATH: process.env.PATH,
      NODE_PATH: path.resolve(__dirname, "../../node_modules"),
      NODE_ENV: "production",
      TZ: timeZone,
      NCD_PATIENTS_BACKEND: backendMode,
      MONGO_URI: uri.toString(),
      DISCORD_BOT_TOKEN: "unused-fixture",
      DISCORD_CHANNEL_ID_SUCCESS: "unused-fixture",
      DISCORD_CHANNEL_ID_PROGRESS: "unused-fixture",
      DISCORD_CHANNEL_ID_ERROR: "unused-fixture",
      CID_HASH_SECRET_KEY: "synthetic-raw-fixture-only",
      PATIENTS_APPLICATION_SOURCE: sourceRoot,
      PATIENTS_APPLICATION_CLOCK: clock,
      PATIENTS_APPLICATION_RESPONSE_HEADERS: JSON.stringify(responseHeaders),
      ...(generationId ? { PATIENTS_CANDIDATE_GENERATION: generationId } : {}),
      ...(activeGeneration ? { PATIENTS_ACTIVE_GENERATION: "1" } : {}),
      ...(capacityFactory ? { PATIENTS_APPLICATION_CAPACITY: "1" } : {}),
      ...(releaseFactory ? { PATIENTS_APPLICATION_RELEASE: "1" } : {}),
    },
  });
  const messages = [],
    waiters = new Set();
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
      for (const waiter of waiters) waiter.reject(new Error("Fixture app exited before ready"));
      waiters.clear();
    });
    child.once("error", (error) => {
      for (const waiter of waiters) waiter.reject(error);
      waiters.clear();
    });
  });
  child.on("message", (message) => {
    const waiter = waiters.values().next().value;
    if (waiter) {
      waiters.delete(waiter);
      waiter.resolve(message);
    } else messages.push(message);
  });
  function receive() {
    if (exited) return Promise.reject(new Error("Fixture app exited before ready"));
    if (messages.length) return Promise.resolve(messages.shift());
    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  }
  async function bound(promise, milliseconds, message) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function stop(graceful) {
    if (exited) return { exited: true, graceful };
    if (graceful && child.connected) child.send("close");
    try {
      await bound(exit, graceful ? shutdownTimeoutMS : 1, "Fixture shutdown deadline");
    } catch {
      graceful = false;
      child.kill("SIGTERM");
      try {
        await bound(exit, 1000, "Fixture termination deadline");
      } catch {
        child.kill("SIGKILL");
        try {
          await bound(exit, 1000, "Fixture kill deadline");
        } catch {
          return { exited: false, graceful: false, dependencySettlement: "unverified" };
        }
      }
    }
    return { exited: true, graceful, dependencySettlement: graceful ? "not-observed" : "unverified" };
  }
  const diagnostics = [];
  let diagnosticBytes = 0;
  child.stderr.on("data", (chunk) => {
    if (diagnosticBytes >= 8192) return;
    const retained = chunk.subarray(0, 8192 - diagnosticBytes);
    diagnosticBytes += retained.length;
    diagnostics.push(retained.toString());
  });
  try {
    const ready = (async () => {
      for (;;) {
        const message = await receive();
        if (message.capacityActor) {
          if (!capacityFactory) throw new Error("Unexpected fixture capacity handshake");
          const config = await capacityFactory(message.capacityActor);
          const trustedOperators = Object.fromEntries(
            Object.entries(config.trustedOperators).map(([id, entry]) => [
              id,
              {
                ...entry,
                publicKey:
                  typeof entry.publicKey === "string"
                    ? entry.publicKey
                    : entry.publicKey.export({ type: "spki", format: "pem" }),
              },
            ])
          );
          child.send({ capacity: { ...config, trustedOperators } });
          continue;
        }
        if (message.releaseSubject) {
          if (!releaseFactory) throw new Error("Unexpected fixture release handshake");
          child.send({ release: await releaseFactory(message.releaseSubject) });
          continue;
        }
        if (message.error) throw new Error(`Fixture app failed: ${message.error}`);
        if (typeof message.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.url))
          throw new Error("Invalid fixture ready message");
        return message;
      }
    })();
    const message = await bound(ready, startupTimeoutMS, "Fixture startup deadline");
    let releaseReport = message.release;
    let closing,
      capturing = false,
      unresolvedId;
    async function rpc(kind, id, timeoutMS = 3000) {
      if (exited || !child.connected) throw new Error("Fixture app is unavailable");
      child.send({ load: { id, kind, timeoutMS } });
      const reply = (await bound(receive(), timeoutMS + 1000, "Fixture evidence deadline"))?.loadReply;
      if (reply?.id !== id || reply.kind !== kind || reply.error || !reply.value)
        throw new Error("Fixture evidence protocol failed");
      return reply.value;
    }
    async function settleLoad({ timeoutMS = 60000 } = {}) {
      if (!Number.isInteger(timeoutMS) || timeoutMS < 1 || timeoutMS > 60000) throw new Error("Invalid evidence bound");
      if (!unresolvedId) throw new Error("No unresolved fixture load");
      const evidence = await rpc("seal", unresolvedId, timeoutMS);
      if (evidence.settlement.safe) unresolvedId = undefined;
      return evidence;
    }
    return {
      url: message.url,
      actor: message.actor,
      runtime: message.runtime,
      productSources: message.productSources,
      generation: message.generation,
      get release() {
        return releaseReport;
      },
      async applyRelease(configuration, kind) {
        if (capturing || unresolvedId || closing || !releaseFactory)
          throw new Error("Fixture release composition is unavailable");
        const id = randomUUID();
        child.send({ releaseUpdate: { id, configuration, kind } });
        const reply = (await bound(receive(), 61000, "Fixture release preparation deadline"))?.releaseReply;
        if (reply?.id !== id || reply.error || !reply.report) throw new Error("Fixture release preparation failed");
        releaseReport = reply.report;
        return releaseReport;
      },
      async rollbackRelease(configuration) {
        return this.applyRelease(configuration, "rollback");
      },
      diagnostics: () => diagnostics.join(""),
      settleLoad,
      async captureLoad({
        bodyBytes,
        origin = "https://fixture.invalid",
        transportTimeoutMS = 65000,
        drainTimeoutMS = 60000,
        signal,
        signals = {},
      } = {}) {
        if (capturing || unresolvedId || closing) throw new Error("A fixture load is already active or unresolved");
        if (typeof bodyBytes !== "string" || Buffer.byteLength(bodyBytes) > 65536)
          throw new Error("Invalid bounded request bytes");
        JSON.parse(bodyBytes);
        for (const value of [transportTimeoutMS, drainTimeoutMS])
          if (!Number.isInteger(value) || value < 1 || value > 90000) throw new Error("Invalid load observation bound");
        if (drainTimeoutMS > 60000 || origin !== "https://fixture.invalid")
          throw new Error("Unsupported fixture observation");
        capturing = true;
        const id = randomUUID();
        try {
          const began = await rpc("begin", id);
          unresolvedId = id;
          const started = monotonicClock.now();
          const responses = await Promise.allSettled(
            PARTS.map(async ({ route }) => {
              const at = monotonicClock.now();
              try {
                const response = await fetch(`${message.url}/ncds_api/api/v1/${route}`, {
                  method: "POST",
                  headers: { "content-type": "application/json", origin },
                  body: bodyBytes,
                  signal: AbortSignal.any([
                    AbortSignal.timeout(transportTimeoutMS),
                    ...(signal ? [signal] : []),
                    ...(signals[route] ? [signals[route]] : []),
                  ]),
                });
                const chunks = [];
                let bytes = 0;
                for await (const chunk of response.body) {
                  bytes += chunk.length;
                  if (bytes > 1048576) throw new Error("Fixture response exceeds fixed buffer allowance");
                  chunks.push(chunk);
                }
                const bodyWire = Buffer.concat(chunks, bytes).toString("utf8");
                const body = JSON.parse(bodyWire);
                return {
                  route,
                  status: response.status,
                  headers: Object.fromEntries(HEADER_NAMES.map((name) => [name, response.headers.get(name)])),
                  body,
                  bodyWire,
                  bodyBytes: bytes,
                  parsed: true,
                  parsedBodyMS: monotonicClock.now() - at,
                };
              } catch (error) {
                return {
                  route,
                  parsed: false,
                  error: ["AbortError", "TimeoutError", "SyntaxError", "TypeError"].includes(error.name)
                    ? error.name
                    : "LoadObservationError",
                  observedMS: monotonicClock.now() - at,
                };
              }
            })
          );
          const captured = responses.map((result, index) =>
            result.status === "fulfilled"
              ? result.value
              : { route: PARTS[index].route, parsed: false, error: "UnsettledCapture" }
          );
          const observedMS = monotonicClock.now() - started;
          const drainAt = monotonicClock.now();
          let evidence;
          try {
            evidence = await settleLoad({ timeoutMS: drainTimeoutMS });
          } catch {
            evidence = {
              errorEvidenceVerified: false,
              queryErrors: [],
              settlement: { safe: false, proof: "child-evidence-unavailable" },
            };
          }
          const allParsed = captured.every((response) => response.parsed);
          return {
            id,
            requestBytes: bodyBytes,
            origin,
            responses: captured,
            combinedObservedMS: observedMS,
            combinedParsedBodiesMS: allParsed ? observedMS : null,
            drainMS: monotonicClock.now() - drainAt,
            telemetry: { ...evidence, preflightCommands: began.preflightCommands },
            queryErrors: evidence.queryErrors,
            errorEvidenceVerified: evidence.errorEvidenceVerified,
            settlement: evidence.settlement,
            complete: allParsed && evidence.settlement.safe,
          };
        } finally {
          capturing = false;
        }
      },
      close: () =>
        (closing ??= stop(true).then((value) => ({
          ...value,
          dependencySettlement: unresolvedId ? "unverified" : "no-unresolved-observed-load",
        }))),
    };
  } catch (error) {
    error.teardown = await stop(false);
    throw error;
  }
}

module.exports = { startApplication };
