const { createHash } = require("node:crypto");
const { BSON } = require("mongodb");
const { CATEGORIES, BSON_OPTIONS } = require("./schema");
const expense = require("./expense");

const VERSION = "daily-card-v1";
const SETS = Object.freeze(["CARD", "HOSPITAL"]);

function checksum(rowId, card) {
  const facts = { ...card };
  delete facts.sha256;
  return createHash("sha256")
    .update(BSON.serialize({ version: VERSION, rowId, facts }))
    .digest("hex");
}

function isAddDataError(error) {
  return error?.name === "MongoServerError" && [14, 16612, 7157722, 7157723].includes(Number(error.code));
}

async function buildDailyCard({ summaries, daily, values, generationId, options, budget }) {
  await summaries.createIndex({ modelRowId: 1 }, { unique: true });
  const cursor = summaries.find({}, options({ ...BSON_OPTIONS, projection: { _id: 1, modelRowId: 1 } }));
  try {
    for await (const summary of cursor) {
      const rowId = summary.modelRowId;
      const match = { $match: { modelRowId: rowId } };
      const [membership] = await summaries
        .aggregate(
          [
            match,
            { $project: { _id: 0, value: { $setUnion: CATEGORIES.slice(0, 6).map(({ field }) => `$${field}`) } } },
          ],
          options({ ...BSON_OPTIONS })
        )
        .toArray();
      const card = { version: VERSION, patientState: Array.isArray(membership.value) ? "array" : "null" };
      try {
        // Evaluate inside a group, like the baseline accumulator. A projection
        // can select a different Mongo execution path for sparse mixed types.
        const [scalar] = await summaries
          .aggregate(
            [
              match,
              {
                $group: {
                  _id: null,
                  value: { $first: { $add: CATEGORIES.slice(0, 6).map(({ service }) => `$${service}`) } },
                },
              },
            ],
            options({ ...BSON_OPTIONS })
          )
          .toArray();
        card.serviceState = "value";
        card.service = scalar.value;
      } catch (error) {
        // These are baseline $add data errors. Preserve the Card's HTTP 500
        // while allowing the independent Bar/graph facts to remain valid.
        if (!isAddDataError(error)) throw error;
        card.serviceState = "error";
        card.serviceError = Number(error.code);
      }
      const [hospital] = await summaries
        .aggregate([match, { $group: { _id: null, value: { $addToSet: "$hcode" } } }], options({ ...BSON_OPTIONS }))
        .toArray();
      card.hospitalState = hospital.value.length ? "present" : "missing";
      card.sha256 = checksum(rowId, card);
      budget.serialized(BSON.serialize({ membership, hospital, card }).length * 4 + 65536);
      await daily.updateOne(
        { generationId, rowId },
        {
          $set: {
            card,
            ...Object.fromEntries(
              SETS.map((id) => [
                `members.${id}`,
                { chunks: 0, cardinality: 0, directorySha256: createHash("sha256").digest("hex") },
              ])
            ),
          },
        }
      );
      for (const [category, kind, operands] of [
        ["CARD", "patient", membership.value ?? []],
        ["HOSPITAL", "hospital", hospital.value],
      ])
        for (const originalBsonValue of operands)
          await values.insertOne({ generationId, rowId, category, kind, originalBsonValue });
    }
  } finally {
    await cursor.close();
  }
}

async function validateDailyCard({ summaries, selection, facts, options }) {
  const match = { $match: selection };
  const patients = await summaries
    .aggregate(
      [
        match,
        { $project: { value: { $setUnion: CATEGORIES.slice(0, 6).map(({ field }) => `$${field}`) } } },
        { $unwind: "$value" },
        { $group: { _id: "$value" } },
        { $count: "count" },
      ],
      options()
    )
    .toArray();
  const hospitals = await summaries
    .aggregate(
      [
        match,
        { $group: { _id: null, values: { $addToSet: "$hcode" } } },
        { $project: { count: { $size: "$values" } } },
      ],
      options()
    )
    .toArray();
  let service = 0,
    serviceError = false;
  try {
    const result = await summaries
      .aggregate(
        [
          match,
          {
            $group: {
              _id: null,
              value: { $sum: { $add: CATEGORIES.slice(0, 6).map(({ service }) => `$${service}`) } },
            },
          },
        ],
        options()
      )
      .toArray();
    service = result[0]?.value ?? 0;
  } catch (error) {
    if (!isAddDataError(error)) throw error;
    serviceError = true;
  }
  if (
    facts.cardPatientCount !== (patients[0]?.count ?? 0) ||
    facts.hospitalCount !== (hospitals[0]?.count ?? 0) ||
    facts.cardServiceError !== serviceError ||
    (!serviceError && !BSON.serialize({ value: service }).equals(BSON.serialize({ value: facts.cardService })))
  )
    throw new Error("Card differential validation failed");
  const baselineError = serviceError || (!facts.empty && facts.cardPatientCount === 0);
  if (!baselineError) {
    const total = facts.expenseTotals.reduce(expense.add, expense.ZERO);
    expense.roundedNumber(total);
    if (facts.cardPatientCount > 0) expense.roundedNumber(total, facts.cardPatientCount);
  }
  return {
    equal: true,
    scope: "full-supported-history",
    patientCount: facts.cardPatientCount,
    hospitalCount: facts.hospitalCount,
    baselineError,
    policy: expense.VERSION,
  };
}

module.exports = { VERSION, SETS, checksum, buildDailyCard, validateDailyCard };
