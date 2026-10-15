const LEGACY = Object.freeze({ mode: "legacy" });

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
function selectPatientsBackend() {
  const mode = process.env.NCD_PATIENTS_BACKEND ?? "legacy";
  if (mode === "legacy") return LEGACY;
  if (mode === "read-model") {
    // No full validated generation or release evidence exists yet. Keep the
    // candidate inactive, including when an operator sets this mode early.
    throw new ReadModelUnavailableError();
  }
  throw new Error("Unsupported NCD_PATIENTS_BACKEND mode");
}

module.exports = { selectPatientsBackend, ReadModelUnavailableError };
