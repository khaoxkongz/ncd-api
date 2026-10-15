const path = require("node:path");
const { MongoClient } = require("mongodb");
const root = process.env.PATIENTS_APPLICATION_SOURCE;
const client = new MongoClient(process.env.MONGO_URI);
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
    if (reader) backend.withCandidateValidation(reader, () => app(req, res));
    else app(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.send({ url: `http://127.0.0.1:${server.address().port}` });
})().catch(async (error) => {
  process.send({ error: error.name });
  await client.close();
  process.exitCode = 1;
});
process.on("message", async (message) => {
  if (message !== "close") return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await client.close();
  process.disconnect();
});
