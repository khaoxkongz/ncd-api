const { parentPort, workerData } = require("node:worker_threads");
const { MongoClient } = require("mongodb");
const { createReader } = require("../../src/modules/patients/read-model/reader");

void (async () => {
  const uri = new URL(workerData.uri);
  if (
    uri.hostname !== "127.0.0.1" ||
    uri.username ||
    uri.password ||
    !workerData.database.startsWith("patients_contract_")
  )
    throw new Error("Only isolated fixture workers are permitted");
  const client = new MongoClient(uri.toString(), { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try {
    const reader = createReader({ db: client.db(workerData.database), validationOnly: true });
    const facts = await reader.read(
      { route: "card/live", backendMode: "candidate-validation", clock: new Date("2024-01-09"), timeZone: "UTC" },
      async ({ rangeFacts }) => {
        const result = await rangeFacts({ date: { $gte: new Date("2024-01-07"), $lte: new Date("2024-01-08") } });
        parentPort.postMessage({ state: "pinned", count: result.cardPatientCount });
        await new Promise((resolve) => parentPort.once("message", resolve));
        return result;
      }
    );
    parentPort.postMessage({ state: "completed", count: facts.cardPatientCount });
  } finally {
    await client.close();
    parentPort.close();
  }
})().catch((error) => {
  parentPort.postMessage({ state: "error", name: error.name });
  process.exitCode = 1;
  parentPort.close();
});
