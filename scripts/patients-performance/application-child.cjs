const path = require("node:path");
const { MongoClient } = require("mongodb");
const root = process.env.PATIENTS_APPLICATION_SOURCE;
const client = new MongoClient(process.env.MONGO_URI, { monitorCommands: true });
const trace = require("./driver-trace.cjs").commandTrace(client);
const clock = process.env.PATIENTS_APPLICATION_CLOCK;
const NativeDate = Date;
class CalculationDate extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return NativeDate.now();
  }
}
global.Date = CalculationDate;
let server;
void (async () => {
  await client.connect();
  const mongoPath = path.join(root, "lib/mongo.js");
  require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { db: client.db() } };
  const app = require(path.join(root, "app.js"));
  let capacity;
  if (process.env.PATIENTS_APPLICATION_CAPACITY) {
    const received = require("node:events").once(process, "message");
    process.send({ capacityActor: require(path.join(root, "modules/patients/read-model/capacity.js")).ACTOR });
    const [message] = await received;
    if (!message?.capacity) throw new Error("Missing fixture capacity composition");
    capacity = message.capacity;
  }
  let reader;
  if (process.env.PATIENTS_CANDIDATE_GENERATION || process.env.PATIENTS_ACTIVE_GENERATION)
    reader = require(path.join(root, "modules/patients/read-model/reader.js")).createReader({
      db: client.db(),
      generationId: process.env.PATIENTS_CANDIDATE_GENERATION,
      validationOnly: true,
      capacity,
    });
  const backend = reader ? require(path.join(root, "modules/patients/backend.js")) : null;
  server = require("node:http").createServer((req, res) => {
    for (const [name, value] of Object.entries(JSON.parse(process.env.PATIENTS_APPLICATION_RESPONSE_HEADERS ?? "{}")))
      res.setHeader(name, value);
    const onSettlement = trace.response(req.url.split("?")[0].split("/").pop(), res);
    if (reader) backend.withCandidateValidation(reader, () => app(req, res), onSettlement);
    else app(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const build = await client
    .db()
    .collection("patients_model_control")
    .findOne({ _id: "patients" }, { projection: { active: 1 } });
  const generation = build?.active
    ? await client.db().collection("patients_generations").findOne({ _id: build.active.generationId })
    : null;
  const mongo = await client.db().admin().command({ buildInfo: 1 });
  const productionFiles = [
    "modules/patients/backend.js",
    "modules/patients/read-model/reader.js",
    "modules/patients/read-model/lifetime.js",
    "modules/patients/read-model/capacity.js",
  ];
  process.send({
    url: `http://127.0.0.1:${server.address().port}`,
    actor: { pid: process.pid, startedAt: Math.round(require("node:perf_hooks").performance.timeOrigin) },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      driver: require("mongodb/package.json").version,
      mongo: mongo.version,
      clock,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    productSources: Object.fromEntries(
      productionFiles
        .filter((file) => require("node:fs").existsSync(path.join(root, file)))
        .map((file) => [
          file,
          require("node:crypto")
            .createHash("sha256")
            .update(require("node:fs").readFileSync(path.join(root, file)))
            .digest("hex"),
        ])
    ),
    generation: generation
      ? {
          id: generation.generationId,
          seal: generation.seal,
          versions: generation.versions,
          sourceSha256: generation.source?.sha256,
          capacityKey: generation.resources?.capacity?.policyKey ?? "unverified",
        }
      : null,
  });
})().catch(async (error) => {
  process.send({ error: error.name });
  await client.close();
  process.exitCode = 1;
});
process.on("message", async (message) => {
  if (message?.load) {
    const { id, kind, timeoutMS } = message.load;
    try {
      const value = kind === "begin" ? trace.begin(id) : kind === "seal" ? await trace.seal(id, timeoutMS) : null;
      if (!value) throw new Error("Unknown fixture load operation");
      process.send({ loadReply: { id, kind, value } });
    } catch (error) {
      process.send({ loadReply: { id, kind, error: error.name } });
    }
    return;
  }
  if (message !== "close") return;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (trace.unresolved) return;
  await client.close();
  process.disconnect();
});
