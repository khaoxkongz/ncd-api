const { Worker, MessageChannel: WorkerChannel, workerData } = require("node:worker_threads");
const { randomUUID } = require("node:crypto");
const { observeDatabase } = require("./lifetime");
const registrations = new WeakMap();
let checkpointEpoch = 0;

function startWorker(filename, data, { pauseAt } = {}) {
  if (pauseAt !== undefined && !["A", "B", "C", "D"].includes(pauseAt))
    throw new Error("Invalid supervised checkpoint");
  const incarnation = randomUUID();
  const { port1, port2 } = new WorkerChannel();
  const nonce = randomUUID();
  let checkpoint;
  const reached = new Promise((resolve) => {
    checkpoint = resolve;
  });
  const worker = new Worker(filename, {
    workerData: { ...data, patientsWorker: incarnation, patientsSupervisor: { port: port2, nonce, pauseAt } },
    transferList: [port2],
  });
  const record = { worker, incarnation, exited: false, quiescent: false, epoch: 0 };
  const registration = Object.freeze({
    worker,
    incarnation,
    checkpoint: reached,
    resume() {
      if (!record.quiescent || record.exited) throw new Error("Resume requires a current acknowledged checkpoint");
      record.quiescent = false;
      port1.postMessage({ nonce, epoch: record.epoch, resume: true });
    },
  });
  port1.on("message", (message) => {
    if (
      message?.nonce === nonce &&
      message.group === pauseAt &&
      Number.isSafeInteger(message.epoch) &&
      message.epoch > record.epoch
    ) {
      record.epoch = message.epoch;
      record.quiescent = true;
      checkpoint({ group: message.group });
    }
  });
  port1.unref();
  worker.once("exit", () => {
    record.exited = true;
    port1.close();
  });
  registrations.set(registration, record);
  return registration;
}

// The actual pre-registered handle is authority for application exit. Persisted
// incarnation/PID/lease state alone never supplies that proof.
function createSupervision(workers = []) {
  const registered = new Map();
  for (const registration of workers) {
    const record = registrations.get(registration);
    if (!record || registered.has(record.incarnation))
      throw new Error("A supervisor-created Worker registration is required");
    registered.set(record.incarnation, record);
  }
  return async function reconcile(db, control, budget) {
    if (!registered.size || !(await control.exists(budget))) return;
    const selected = await control.read(budget);
    for (const [incarnation, record] of registered) {
      if (
        !record.exited ||
        !record.quiescent ||
        !(selected.builder?.worker === incarnation || selected.pins.some((pin) => pin.worker === incarnation))
      )
        continue;
      const proof = await observeDatabase(db, { worker: incarnation });
      if (!proof.safe) continue;
      await control.change(budget, (document) => {
        if (selected.builder?.worker === incarnation) {
          if (
            document.builder?.run !== selected.builder.run ||
            document.builder.worker !== incarnation ||
            !document.fence.equals(selected.fence)
          )
            throw new Error("Crashed Builder ownership changed");
          const slot = document.slots.find((item) => item.generationId === document.builder.generationId);
          Object.assign(slot, {
            state: "failed",
            settled: true,
            termination: { worker: incarnation, proof: proof.proof },
          });
          document.builder = null;
        }
        document.pins = document.pins.filter((pin) => pin.worker !== incarnation);
        if (document.capacity)
          document.capacity.owners = document.capacity.owners.filter((item) => item.worker !== incarnation);
        return true;
      });
    }
  };
}

async function pauseCheckpoint(scope, group) {
  const supervisor = workerData?.patientsSupervisor;
  if (supervisor?.pauseAt !== group) return;
  scope.stop();
  const proof = await scope.drain();
  if (!proof.safe) throw new Error("Supervised checkpoint is not quiescent");
  const epoch = ++checkpointEpoch;
  // Sent only after every registered command/cursor has settled successfully.
  // No next model dispatch can occur until this private channel grants it.
  await new Promise((resolve) => {
    const resume = (message) => {
      if (message?.nonce !== supervisor.nonce || message.epoch !== epoch || !message.resume) return;
      supervisor.port.off("message", resume);
      resolve();
    };
    supervisor.port.on("message", resume);
    supervisor.port.postMessage({ nonce: supervisor.nonce, group, epoch });
  });
  scope.resume();
}

module.exports = { createSupervision, startWorker, pauseCheckpoint };
