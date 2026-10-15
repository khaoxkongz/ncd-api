const { fork } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");

async function startApplication({
  db,
  generationId,
  sourceRoot = path.resolve(__dirname, "../../src"),
  clock = "2024-01-03T00:00:00.000Z",
  timeZone = "UTC",
  responseHeaders = {},
}) {
  sourceRoot = require("node:fs").realpathSync(sourceRoot);
  const uri = new URL(process.env.PATIENTS_TEST_MONGO_URI);
  if (uri.hostname !== "127.0.0.1" || uri.username || uri.password || !db.databaseName.startsWith("patients_contract_"))
    throw new Error("Only isolated loopback fixture apps are allowed");
  uri.pathname = `/${db.databaseName}`;
  const child = fork(path.join(__dirname, "application-child.cjs"), [], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
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
    },
  });
  const timer = setTimeout(() => child.kill(), 20000);
  child.stderr.resume();
  try {
    const [message] = await once(child, "message");
    if (message.error) throw new Error(`Fixture app failed: ${message.error}`);
    clearTimeout(timer);
    return {
      url: message.url,
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
