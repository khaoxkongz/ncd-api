const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");

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
}) {
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
      NCD_PATIENTS_BACKEND: "legacy",
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
    },
  });
  const timer = setTimeout(() => child.kill(), 20000);
  const diagnostics = [];
  let diagnosticBytes = 0;
  child.stderr.on("data", (chunk) => {
    if (diagnosticBytes >= 8192) return;
    const retained = chunk.subarray(0, 8192 - diagnosticBytes);
    diagnosticBytes += retained.length;
    diagnostics.push(retained.toString());
  });
  try {
    let message;
    for (;;) {
      [message] = await once(child, "message");
      if (!message.capacityActor) break;
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
    }
    if (message.error) throw new Error(`Fixture app failed: ${message.error}`);
    clearTimeout(timer);
    return {
      url: message.url,
      diagnostics: () => diagnostics.join(""),
      async close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        if (child.connected) child.send("close");
        await once(child, "exit");
      },
    };
  } catch (error) {
    clearTimeout(timer);
    child.kill();
    throw error;
  }
}

module.exports = { startApplication };
