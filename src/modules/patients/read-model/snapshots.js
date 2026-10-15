const { createHash } = require("node:crypto");
const { BSON } = require("mongodb");
const { CATEGORIES, VERSIONS, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { storedPeriods } = require("./stored-months");
const { generationProvenance, sourceState } = require("./metadata");
const expense = require("./expense");

const VERSION = "endpoint-snapshots-v1";
const ENDPOINTS = ["card", "patients-bar", "expense-bar", "disease-patients", "dm-patients", "ca-patients"];

function checksum(document) {
  const { _id, sha256: _sha256, ...content } = document;
  return createHash("sha256").update(BSON.serialize(content)).digest("hex");
}

function validateViews(views) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const fields = (row, names) =>
    row && Object.keys(row).length === names.length && names.every((name) => Object.hasOwn(row, name));
  const service = (value) =>
    typeof value === "number" || ["Int32", "Double", "Long", "Decimal128"].includes(value?._bsontype);
  function amount(value) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      expense.roundedNumber(expense.fromOperand(value)) !== value
    )
      throw new Error("Unsafe snapshot expense output");
  }
  for (const endpoint of ENDPOINTS) {
    const result = views?.[endpoint];
    if (!Array.isArray(result)) throw new Error("Missing full endpoint view");
    // Stored [] is a real completed endpoint output in the baseline contract.
    if (!result.length) continue;
    if (endpoint === "card") {
      const row = result[0];
      if (
        result.length !== 1 ||
        !fields(row, ["service_count", "patient_count", "expense", "hcode_count", "avg_service", "avg_expense"]) ||
        !count(row.patient_count) ||
        !count(row.hcode_count) ||
        !service(row.service_count) ||
        typeof row.avg_service !== "number"
      )
        throw new Error("Unusable Card snapshot");
      amount(row.expense);
      amount(row.avg_expense);
    } else if (endpoint.endsWith("-bar")) {
      if (result.length !== 6) throw new Error("Unusable Bar snapshot");
      for (const [index, row] of result.entries()) {
        if (
          !fields(row, ["diseaseName", endpoint === "patients-bar" ? "qtyOfPatient" : "qtyOfExpense", "avg"]) ||
          row.diseaseName !== CATEGORIES[index].label
        )
          throw new Error("Unusable Bar snapshot");
        if (endpoint === "patients-bar") {
          if (!count(row.qtyOfPatient) || typeof row.avg !== "number")
            throw new Error("Unsafe snapshot Patients Bar output");
        } else {
          amount(row.qtyOfExpense);
          amount(row.avg);
        }
      }
    } else {
      const graph = endpoint.split("-")[0];
      const expected = require("./graphs").present(graph, {
        counts: Array.from({ length: 12 }, () => Array(15).fill(0)),
      });
      if (
        result.length !== expected.length ||
        result.some(
          (row, index) =>
            !fields(row, ["diseaseName", "data"]) ||
            row.diseaseName !== expected[index].diseaseName ||
            !Array.isArray(row.data) ||
            row.data.length !== 12 ||
            row.data.some((value) => !count(value))
        )
      )
        throw new Error("Unusable graph snapshot");
    }
  }
}

async function buildSnapshots({ db, generation, clock, timeZone, budget }) {
  const reader = require("./reader").createReader({ db, generationId: generation.generationId, validationOnly: true });
  // The legacy snapshot producer passes Date objects to the range services,
  // whose repositories interpolate them before making their query Dates.
  const selection = {
    date: { $gte: new Date(String(new Date("2024-01-07T00:00:00.000Z"))), $lte: new Date(String(clock)) },
  };
  const capturedPeriod = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" })
      .formatToParts(clock)
      .filter(({ type }) => type === "year" || type === "month")
      .map(({ type, value }) => [type, Number(value)])
  );
  const periods = storedPeriods(new Date(capturedPeriod.year, capturedPeriod.month - 1, 15));
  const views = await reader.read(
    {
      route: "snapshots/build",
      backendMode: "candidate-validation",
      clock,
      timeZone,
      timeoutMS: Math.min(60000, budget.check()),
    },
    async ({ rangeFacts, monthFacts }) => {
      const range = await rangeFacts(selection);
      const months = await monthFacts({}, periods);
      return {
        card: require("./card").present(range),
        "patients-bar": require("./patients-bar").present(range),
        "expense-bar": require("./expense-bar").present(range),
        "disease-patients": require("./graphs").present("disease", months),
        "dm-patients": require("./graphs").present("dm", months),
        "ca-patients": require("./graphs").present("ca", months),
      };
    }
  );
  const document = {
    generationId: generation.generationId,
    complete: true,
    version: VERSION,
    versions: VERSIONS,
    provenance: {
      source: generationProvenance(generation),
      sourceVersion: generation.source.sourceVersion,
      history: generation.source.history,
      domainRevision: generation.source.domain.revision,
      selection: { range: selection, geography: {}, rule: "first-generation-view" },
      clock,
      timeZone,
      periods,
      arithmetic: VERSIONS.arithmetic,
      serviceArithmetic: VERSIONS.serviceArithmetic,
    },
    views,
  };
  validateViews(views);
  document.sha256 = checksum(document);
  budget.serialized(BSON.serialize(document).length * 8 + 65536);
  await db.collection(COLLECTIONS.snapshots).insertOne(document, budget.options());
  return {
    documents: 1,
    endpoints: ENDPOINTS.length,
    version: VERSION,
    clock,
    timeZone,
    periods,
    selection,
    source: document.provenance.source,
  };
}

async function readSnapshot({ db, generation, endpoint, clock, budget }) {
  if (
    !ENDPOINTS.includes(endpoint) ||
    !generation.components.snapshots?.complete ||
    generation.components.snapshots.generationId !== generation.generationId
  )
    throw new Error("Incomplete snapshot component");
  const collection = db.collection(COLLECTIONS.snapshots);
  if (
    (await collection.countDocuments({ generationId: generation.generationId }, budget.options())) !==
    generation.inventory.snapshotDocuments
  )
    throw new Error("Changed snapshot inventory");
  // Keep the baseline first selected document. There is no main-key match,
  // ordering replacement, refresh to the request window or live fallback.
  const document = await collection.findOne(
    { generationId: generation.generationId },
    budget.options({ ...BSON_OPTIONS })
  );
  if (!document) throw new Error("Missing selected snapshot");
  budget.serialized(BSON.serialize(document).length * 8 + 65536);
  if (document.sha256 !== checksum(document)) throw new Error("Changed selected snapshot");
  const view = BSON.deserialize(BSON.serialize(document));
  if (
    view.generationId !== generation.generationId ||
    view.complete !== true ||
    view.version !== VERSION ||
    !view.versions ||
    Object.keys(view.versions).length !== Object.keys(VERSIONS).length ||
    !Object.entries(VERSIONS).every(([key, value]) => view.versions[key] === value) ||
    ENDPOINTS.some((key) => !Array.isArray(view.views?.[key])) ||
    !(view.provenance?.clock instanceof Date) ||
    !Number.isFinite(view.provenance.clock.getTime()) ||
    typeof view.provenance.timeZone !== "string" ||
    view.provenance.arithmetic !== VERSIONS.arithmetic ||
    view.provenance.serviceArithmetic !== VERSIONS.serviceArithmetic ||
    !Array.isArray(view.provenance.periods) ||
    view.provenance.periods.length !== 12 ||
    !view.provenance.selection ||
    !view.provenance.source ||
    typeof view.provenance.source.coverageVerified !== "boolean"
  )
    throw new Error("Unusable selected snapshot");
  const cut = view.provenance.source.sourceCutAt;
  if (cut !== null && (typeof cut !== "string" || !Number.isFinite(new Date(cut).getTime())))
    throw new Error("Invalid snapshot source provenance");
  if (
    typeof view.provenance.sourceVersion !== "string" ||
    !view.provenance.sourceVersion ||
    typeof view.provenance.domainRevision !== "string" ||
    !view.provenance.domainRevision ||
    !view.provenance.history ||
    !Number.isFinite(new Date(view.provenance.history.start).getTime()) ||
    !Number.isFinite(new Date(view.provenance.history.end).getTime()) ||
    view.provenance.selection.rule !== "first-generation-view" ||
    !view.provenance.selection.geography ||
    !(view.provenance.selection.range?.date?.$gte instanceof Date) ||
    !(view.provenance.selection.range?.date?.$lte instanceof Date) ||
    view.provenance.periods.some(
      ({ year, month }, index, periods) =>
        !Number.isSafeInteger(year) ||
        !Number.isSafeInteger(month) ||
        month < 1 ||
        month > 12 ||
        (index > 0 && year * 12 + month !== periods[index - 1].year * 12 + periods[index - 1].month + 1)
    )
  )
    throw new Error("Incomplete snapshot selection or period provenance");
  if (
    !Number.isFinite(view.provenance.selection.range.date.$gte.getTime()) ||
    !Number.isFinite(view.provenance.selection.range.date.$lte.getTime())
  )
    throw new Error("Invalid snapshot range provenance");
  new Intl.DateTimeFormat("en-US", { timeZone: view.provenance.timeZone });
  validateViews(view.views);
  return Object.freeze({ result: view.views[endpoint], source: sourceState(view.provenance.source, clock) });
}

module.exports = { buildSnapshots, readSnapshot };
