const { parentPort, workerData } = require("node:worker_threads");
const { MongoClient } = require("mongodb");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const uri = new URL(workerData.uri);
if (
  uri.hostname !== "127.0.0.1" ||
  uri.username ||
  uri.password ||
  !workerData.database.startsWith("patients_contract_")
)
  throw new Error("Only isolated recovery workers are permitted");
parentPort.once("message", async () => {
  const client = new MongoClient(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(workerData.database),
      clock: () => new Date(workerData.clock),
      timeZone: "UTC",
    });
    const cut = {
      ...workerData.sourceCut,
      manifest: Buffer.from(workerData.sourceCut.manifest),
      signature: Buffer.from(workerData.sourceCut.signature),
    };
    const report = await builder.build(cut, workerData.budget, workerData.context);
    parentPort.postMessage({ state: "completed", generationId: report.generationId });
  } catch (error) {
    parentPort.postMessage({ state: "failed", name: error.name });
  } finally {
    await client.close();
    parentPort.close();
  }
});
