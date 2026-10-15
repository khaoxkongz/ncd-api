const LEGACY = Object.freeze({ mode: "legacy" });
const { AsyncLocalStorage } = require("node:async_hooks");
const candidateValidation = new AsyncLocalStorage();

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
  const validation = candidateValidation.getStore();
  if (validation) {
    if (!["patients-bar", "expense-bar", "patients-graphs", "card"].includes(route))
      throw new ReadModelUnavailableError();
    if (!req || !res) return validation;
    const cancellation = new AbortController();
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
          validation.reader.read({ ...context, signal: context.signal ?? cancellation.signal }, callback),
      },
    };
  }
  const mode = process.env.NCD_PATIENTS_BACKEND ?? "legacy";
  if (mode === "legacy") return LEGACY;
  if (mode === "read-model") {
    // No full validated generation or release evidence exists yet. Keep the
    // candidate inactive, including when an operator sets this mode early.
    throw new ReadModelUnavailableError();
  }
  throw new Error("Unsupported NCD_PATIENTS_BACKEND mode");
}

// Private process-side validation context. No request parameter, header, route
// or environment selector can activate a partial generation through this seam.
function withCandidateValidation(reader, callback) {
  return candidateValidation.run({ mode: "candidate-validation", reader }, callback);
}

module.exports = { selectPatientsBackend, ReadModelUnavailableError, withCandidateValidation };
