const { createHash } = require("node:crypto");
const { BSON } = require("mongodb");
const { COLLECTIONS, VERSIONS, BSON_OPTIONS, CATEGORIES } = require("./schema");

function descriptorSeal(document) {
  const { _id, seal: _seal, ...content } = document;
  return createHash("sha256").update(BSON.serialize(content)).digest("hex");
}

async function inventories(db, generationId, budget) {
  const result = {};
  for (const name of Object.values(COLLECTIONS).filter((value) => value !== COLLECTIONS.generations)) {
    const digest = createHash("sha256");
    let count = 0;
    const cursor = db
      .collection(name)
      .find({ generationId }, budget.options({ ...BSON_OPTIONS, collation: { locale: "simple" } }))
      .sort({ _id: 1 });
    try {
      for await (const row of cursor) {
        budget.serialized(BSON.serialize(row).length * 4 + 65536);
        digest.update(BSON.serialize(row));
        count += 1;
      }
    } finally {
      await cursor.close();
    }
    result[name] = { count, sha256: digest.digest("hex") };
  }
  return result;
}

function complete(document) {
  const required = [
    "patientsBar",
    "daily",
    "dictionary",
    "patientDictionary",
    "hospitalDictionary",
    "monthlyStored",
    "monthlyDateUtc",
    "preparedDateUtc",
    "preparedScopes",
    "preparedStored",
    "card",
    "expenseBar",
    "snapshots",
    "control",
  ];
  if (
    !document ||
    document.complete !== true ||
    document.state !== "ready" ||
    document.comparisonOnly ||
    document.source?.dataset !== "raw" ||
    document.source.rawComplete !== true ||
    document.source.complete !== true ||
    document.source.consistency !== "producer-sealed-full-export" ||
    document.source.domain?.allSupportedHistory !== true ||
    Object.keys(VERSIONS).length !== Object.keys(document.versions ?? {}).length ||
    !Object.entries(VERSIONS).every(([key, value]) => document.versions[key] === value) ||
    required.some(
      (key) =>
        document.components[key]?.complete !== true || document.components[key].generationId !== document.generationId
    ) ||
    document.inventory?.generationId !== document.generationId ||
    document.bindings?.length !== 15 ||
    CATEGORIES.some(
      ({ id, field }, index) => document.bindings[index]?.id !== id || document.bindings[index]?.field !== field
    ) ||
    document.inventory.stages.some((stage) => stage.complete !== true)
  )
    throw new Error("Incomplete or incompatible full generation");
  for (const name of [
    "patientsBar",
    "expenseBar",
    "monthlyStored",
    "preparedStored",
    "monthlyDateUtc",
    "preparedDateUtc",
  ])
    if (document.validation?.[name]?.equal !== true) throw new Error("Missing differential generation validation");
  if (
    document.validation.card?.equal !== true ||
    document.validation.preparedStored?.setsEqual !== true ||
    document.validation.monthlyDateUtc?.setsEqual !== true ||
    document.validation.snapshots?.endpoints !== 6 ||
    document.inventory.snapshotDocuments !== 1
  )
    throw new Error("Missing full Card or snapshot validation");
  if (document.seal !== descriptorSeal(document)) throw new Error("Changed immutable generation descriptor");
}

async function verify(db, candidate, budget, { contents = false } = {}) {
  const document = await db
    .collection(COLLECTIONS.generations)
    .findOne({ _id: candidate.generationId }, budget.options());
  complete(document);
  if (candidate.seal && candidate.seal !== document.seal) throw new Error("Candidate descriptor seal changed");
  if (contents) {
    const actual = await inventories(db, document.generationId, budget);
    if (!BSON.serialize(actual).equals(BSON.serialize(document.inventory.collections)))
      throw new Error("Generation contents no longer match sealed inventories");
  }
  return document;
}

module.exports = { descriptorSeal, inventories, complete, verify };
