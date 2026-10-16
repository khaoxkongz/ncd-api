const LEGACY = Object.freeze({ mode: "legacy" });
const { AsyncLocalStorage } = require("node:async_hooks");
const candidateValidation = new AsyncLocalStorage();
let installed = Object.freeze({ mode: process.env.NCD_PATIENTS_BACKEND ?? "legacy" });

class ReadModelUnavailableError extends Error {
  constructor() {
    super("Read model unavailable");
    this.name = "ReadModelUnavailableError";
  }
}

// This is the single selection point for all six Patients endpoints. Selection
// happens before a request reads data and stays fixed for that request. Native
// codec and source acquisition belong to later explicit validation/build work;
// importing this module must never initialize either dependency.
function selectPatientsBackend(route, req, res) {
  const context = candidateValidation.getStore();
  const validation = context?.reader
    ? context
    : installed.reader
      ? { ...installed, onSettlement: context?.onSettlement }
      : null;
  if (validation) {
    if (!["patients-bar", "expense-bar", "patients-graphs", "card"].includes(route))
      throw new ReadModelUnavailableError();
    if (!req || !res) return validation;
    const cancellation = new AbortController();
    const { HTTP_CAPACITY, responseCapacity } = require("./read-model/capacity");
    const responseOwner = responseCapacity(res, validation.onSettlement);
    const abort = () => {
      if (!res.writableFinished) cancellation.abort();
    };
    const detach = () => {
      req.off("aborted", abort);
      res.off("close", abort);
    };
    req.once("aborted", abort);
    res.once("close", abort);
    res.once("finish", detach);
    res.once("close", detach);
    return {
      ...validation,
      reader: {
        read: (context, callback) =>
          validation.reader.read(
            {
              ...context,
              backendMode: validation.mode,
              signal: context.signal ?? cancellation.signal,
              [HTTP_CAPACITY]: responseOwner,
            },
            callback
          ),
      },
    };
  }
  const mode = installed.mode;
  if (mode === "legacy") return LEGACY;
  context?.onSettlement?.({ safe: true, proof: "backend-rejected-before-reader-acquisition" });
  if (mode === "read-model") {
    // No full validated generation or release evidence exists yet. Keep the
    // candidate inactive, including when an operator sets this mode early.
    throw new ReadModelUnavailableError();
  }
  throw new Error("Unsupported NCD_PATIENTS_BACKEND mode");
}

// Called by the composition root before listening, or by an explicit operator
// rollback. Changing an environment value during a request cannot select data.
async function initializePatientsBackend({
  mode = process.env.NCD_PATIENTS_BACKEND ?? "legacy",
  db,
  capacity,
  release,
} = {}) {
  if (mode === "legacy") {
    installed = LEGACY;
    return Object.freeze({ mode, activation: "legacy" });
  }
  let preparation;
  if (mode === "read-model") {
    preparation = await require("./read-model/release").prepareRelease({
      db: db ?? require("../../lib/mongo").db,
      capacity,
      ...release,
      ...(!release ? { configFile: process.env.NCD_PATIENTS_RELEASE_CONFIG } : {}),
    });
  }
  installed = preparation?.runtime ?? Object.freeze({ mode });
  return Object.freeze(
    preparation?.report ?? {
      mode,
      activation: "blocked",
      targetActivation: "blocked",
      reason: "release-evidence-missing",
    }
  );
}

// Private process-side validation context. No request parameter, header, route
// or environment selector can activate a partial generation through this seam.
function withCandidateValidation(reader, callback, onSettlement) {
  return candidateValidation.run({ mode: "candidate-validation", reader, onSettlement }, callback);
}

function withPatientsObservation(callback, onSettlement) {
  return candidateValidation.run({ onSettlement }, callback);
}

async function rollbackPatientsBackend({ target, expectedActive, builder, db, capacity, release } = {}) {
  if (target === "legacy") return initializePatientsBackend({ mode: "legacy" });
  if (
    !builder ||
    typeof target !== "string" ||
    !expectedActive?.generationId ||
    !/^[1-9][0-9]{0,18}$/.test(expectedActive.publicationVersion)
  )
    throw new ReadModelUnavailableError();
  const publicationVersion = (BigInt(expectedActive.publicationVersion) + 1n).toString();
  const gate = require("./read-model/release");
  const preparation = await gate.prepareRelease({ db, capacity, ...release });
  if (!preparation.runtime) throw new ReadModelUnavailableError();
  gate.authorizePublication(preparation.runtime, target, publicationVersion);
  const active = await builder.rollback(target, expectedActive);
  if (active.generationId !== target || active.publicationVersion !== publicationVersion)
    throw new ReadModelUnavailableError();
  gate.authorizePublication(preparation.runtime, active.generationId, active.publicationVersion);
  installed = preparation.runtime;
  return Object.freeze({ ...preparation.report, rollback: active });
}

module.exports = {
  selectPatientsBackend,
  ReadModelUnavailableError,
  withCandidateValidation,
  initializePatientsBackend,
  withPatientsObservation,
  rollbackPatientsBackend,
};
