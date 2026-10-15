const { createHash, randomUUID } = require("node:crypto");
const { BSON, Binary } = require("mongodb");
const { CATEGORIES, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { writeChunks, decodeChunk, codec } = require("./bitmap");

const GEOGRAPHY = ["area", "province", "district", "hcode"];

function digest(document) {
  const { _id, sha256: _sha256, ...facts } = document;
  return createHash("sha256").update(BSON.serialize(facts)).digest("hex");
}

function predicate(scope) {
  return scope.scopeKind === "national" ? {} : { [scope.scopeKind]: { $eq: scope.value } };
}

function preparedKind(scope) {
  const fields = Object.keys(scope);
  if (!fields.length) return "national";
  if (fields.length !== 1 || !GEOGRAPHY.includes(fields[0])) return;
  const value = scope[fields[0]];
  // A regular expression or operator document is a query, not the catalog's
  // implicit equality predicate. Its complete predicate stays on the atom path.
  if (
    value instanceof RegExp ||
    value?._bsontype === "BSONRegExp" ||
    (value &&
      !Array.isArray(value) &&
      typeof value === "object" &&
      Object.keys(value).some((key) => key.startsWith("$")))
  )
    return;
  return fields[0];
}

async function buildScopeCatalog({ db, daily, generationId, budget, collation, indexSuffix }) {
  const scopes = db.collection(COLLECTIONS.scopes);
  const options = (extra = {}) => budget.options({ collation, ...extra });
  await scopes.createIndex({ generationId: 1, scopeId: 1 }, { unique: true });
  await scopes.createIndex(
    { generationId: 1, scopeKind: 1, value: 1 },
    { collation, name: `patients_scope_value_${indexSuffix}` }
  );
  async function addScope(scopeKind, value) {
    const typedScope = scopeKind === "national" ? {} : { [scopeKind]: value };
    const predicateKey = new Binary(BSON.serialize(typedScope));
    const query = { generationId, scopeKind, value: { $eq: value }, predicateKey };
    if (await scopes.findOne(query, options({ projection: { _id: 1 } }))) return;
    const document = { generationId, scopeId: `${generationId}:scope:${randomUUID()}`, scopeKind, value, predicateKey };
    document.sha256 = digest(document);
    budget.serialized(BSON.serialize(document).length * 4 + 65536);
    await scopes.insertOne(document);
  }
  await addScope("national", null);
  const source = daily.find(
    { generationId },
    options({ ...BSON_OPTIONS, projection: Object.fromEntries(GEOGRAPHY.map((field) => [field, 1])) })
  );
  try {
    for await (const row of source) {
      for (const field of GEOGRAPHY) {
        if (!Object.hasOwn(row, field)) continue;
        await addScope(field, row[field]);
        // Scalar equality also matches an observed element of an array field.
        if (Array.isArray(row[field])) for (const value of row[field]) await addScope(field, value);
      }
    }
  } finally {
    await source.close();
  }
  return scopes.countDocuments({ generationId }, options());
}

async function lookupPreparedScope({ db, generationId, scope, budget, collation }) {
  const kind = preparedKind(scope);
  if (!kind) return;
  const selected = await db
    .collection(COLLECTIONS.scopes)
    .find(
      {
        generationId,
        scopeKind: kind,
        value: { $eq: kind === "national" ? null : scope[kind] },
        predicateKey: new Binary(BSON.serialize(scope)),
      },
      budget.options({ collation, ...BSON_OPTIONS })
    )
    .limit(2)
    .toArray();
  if (!selected.length) return;
  if (selected.length !== 1 || selected[0].sha256 !== digest(selected[0]))
    throw new Error("Changed prepared scope descriptor");
  return selected[0];
}

async function buildPreparedScopes({
  db,
  daily,
  edges,
  generationId,
  prefix,
  budget,
  collation,
  indexSuffix,
  measureStorage,
}) {
  await buildScopeCatalog({ db, daily, generationId, budget, collation, indexSuffix });
  const scopes = db.collection(COLLECTIONS.scopes),
    months = db.collection(COLLECTIONS.monthScopes);
  const rows = db.collection(`${prefix}_scope_rows`),
    scopeEdges = db.collection(`${prefix}_scope_edges`);
  const options = (extra = {}) => budget.options({ collation, ...extra });
  await months.createIndex({ generationId: 1, periodKind: 1, periodKey: 1, scopeId: 1 }, { unique: true });
  await months.createIndex({ generationId: 1, rowId: 1 }, { unique: true });
  try {
    const catalog = scopes.find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const scope of catalog) {
        const selected = daily.find(
          { ...predicate(scope), generationId },
          options({ ...BSON_OPTIONS, projection: { rowId: 1, year: 1, month: 1 } })
        );
        try {
          for await (const row of selected) {
            const original = Object.fromEntries(
              ["year", "month"].filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])
            );
            const promoted = BSON.deserialize(BSON.serialize(original));
            const graphVisible = typeof promoted.year === "number" && typeof promoted.month === "number";
            // All presentable numeric BSON kinds share the baseline numeric
            // cell. Union them while retaining their exact original periods.
            const period = graphVisible ? { year: promoted.year, month: promoted.month } : original;
            const periodKey = new Binary(BSON.serialize(period));
            const document = {
              generationId,
              rowId: `${generationId}:stored-scope:${randomUUID()}`,
              scopeId: scope.scopeId,
              scopeSha256: scope.sha256,
              periodKind: "stored",
              periodKey,
              ...(Object.hasOwn(period, "year") ? { storedYear: period.year } : {}),
              ...(Object.hasOwn(period, "month") ? { storedMonth: period.month } : {}),
              graphVisible,
              members: Object.fromEntries(
                CATEGORIES.map(({ id }) => [
                  id,
                  { chunks: 0, cardinality: 0, directorySha256: createHash("sha256").digest("hex") },
                ])
              ),
            };
            budget.serialized(BSON.serialize(document).length * 4 + 65536);
            const month = await months.findOneAndUpdate(
              { generationId, periodKind: "stored", periodKey, scopeId: scope.scopeId },
              {
                $setOnInsert: document,
                $inc: { matchedRows: 1 },
                $addToSet: { sourcePeriods: { periodKey: new Binary(BSON.serialize(original)), ...original } },
              },
              options({ upsert: true, returnDocument: "after", ...BSON_OPTIONS })
            );
            budget.serialized(BSON.serialize(month).length * 4 + 65536);
            await rows.insertOne({ rowId: row.rowId, setId: month.rowId });
          }
        } finally {
          await selected.close();
        }
      }
    } finally {
      await catalog.close();
    }
    await rows.createIndex({ rowId: 1 });
    const members = edges.aggregate(
      [
        { $match: { generationId, category: { $in: CATEGORIES.map(({ id }) => id) } } },
        { $lookup: { from: rows.collectionName, localField: "setId", foreignField: "rowId", as: "scopes" } },
        { $unwind: "$scopes" },
        { $project: { _id: 0, generationId: 1, setId: "$scopes.setId", category: 1, block: 1, offset: 1 } },
      ],
      options({ ...BSON_OPTIONS })
    );
    try {
      for await (const member of members) {
        budget.serialized(BSON.serialize(member).length * 4 + 65536);
        await scopeEdges.insertOne(member);
      }
    } finally {
      await members.close();
    }
    await scopeEdges.createIndex({ setId: 1, category: 1, block: 1, offset: 1 });
    await writeChunks({
      edges: scopeEdges,
      chunks: db.collection(COLLECTIONS.chunks),
      directory: db.collection(COLLECTIONS.directory),
      daily: months,
      generationId,
      budget,
    });
    const prepared = months.find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const month of prepared) {
        budget.serialized(BSON.serialize(month).length * 4 + 65536);
        await months.updateOne({ _id: month._id }, { $set: { sha256: digest(month) } });
      }
    } finally {
      await prepared.close();
    }
    await months.createIndex(
      { generationId: 1, periodKind: 1, scopeId: 1, storedYear: 1, storedMonth: 1 },
      { collation, partialFilterExpression: { graphVisible: true }, name: `patients_scope_period_${indexSuffix}` }
    );
    await measureStorage();
  } finally {
    await rows.drop();
    await scopeEdges.drop();
  }
  return {
    scopes: await scopes.countDocuments({ generationId }, options()),
    storedScopePeriods: await months.countDocuments({ generationId }, options()),
  };
}

async function calculatePreparedMonths({ db, generation, scope, periods, budget }) {
  if (!preparedKind(scope)) return;
  if (
    !generation.components.preparedStored?.complete ||
    generation.components.preparedStored.generationId !== generation.generationId
  )
    throw new Error("Incomplete prepared stored-month component");
  const generationId = generation.generationId;
  const scopes = db.collection(COLLECTIONS.scopes),
    months = db.collection(COLLECTIONS.monthScopes);
  const options = (extra = {}) => budget.options({ collation: generation.collation, ...extra });
  if (
    (await scopes.countDocuments({ generationId }, options())) !== generation.inventory.scopes ||
    (await months.countDocuments({ generationId }, options())) !== generation.inventory.storedScopePeriods
  )
    throw new Error("Prepared stored-month inventory changed");
  const selected = await lookupPreparedScope({ db, generationId, scope, budget, collation: generation.collation });
  if (!selected) return;
  const counts = periods.map(() => CATEGORIES.map(() => 0));
  const seen = new Set();
  const cursor = months.find(
    {
      generationId,
      scopeId: selected.scopeId,
      periodKind: "stored",
      graphVisible: true,
      $or: periods.map(({ year, month }) => ({ storedYear: year, storedMonth: month })),
    },
    options({ ...BSON_OPTIONS })
  );
  try {
    for await (const row of cursor) {
      budget.serialized(BSON.serialize(row).length * 4 + 65536);
      const index = periods.findIndex(
        ({ year, month }) => year === Number(row.storedYear) && month === Number(row.storedMonth)
      );
      if (index < 0 || seen.has(index) || row.sha256 !== digest(row) || row.scopeSha256 !== selected.sha256)
        throw new Error("Changed prepared stored-month facts");
      seen.add(index);
      for (const [category, { id }] of CATEGORIES.entries()) {
        const value = row.members?.[id];
        const cardinality = Number(value?.cardinality),
          chunks = Number(value?.chunks);
        if (
          !Number.isSafeInteger(cardinality) ||
          cardinality < 0 ||
          !Number.isSafeInteger(chunks) ||
          chunks < 0 ||
          (cardinality === 0) !== (chunks === 0) ||
          !/^[a-f0-9]{64}$/.test(value.directorySha256)
        )
          throw new Error("Missing prepared stored-month set inventory");
        counts[index][category] = cardinality;
      }
    }
  } finally {
    await cursor.close();
  }
  return Object.freeze({
    counts: Object.freeze(counts.map(Object.freeze)),
    periods: Object.freeze(periods.map((period) => Object.freeze({ ...period }))),
    categories: Object.freeze(CATEGORIES.map(({ id }) => id)),
  });
}

async function validatePreparedScopes({ db, summaries, generationId, budget, collation, clock }) {
  const reader = require("./reader").createReader({ db, generationId, validationOnly: true });
  const { periodWindow } = require("./stored-months");
  const options = (extra = {}) => budget.options({ collation, ...extra });
  let scopes = 0,
    cells = 0,
    setBlocks = 0,
    windows = 0;
  const cursor = db.collection(COLLECTIONS.scopes).find({ generationId }, options({ ...BSON_OPTIONS }));
  try {
    for await (const scope of cursor) {
      setBlocks += await validateScopeSets({ db, generationId, scope, budget, collation });
      const typed = scope.scopeKind === "national" ? {} : { [scope.scopeKind]: scope.value };
      const rows = db
        .collection(COLLECTIONS.monthScopes)
        .find({ generationId, scopeId: scope.scopeId, graphVisible: true }, options())
        .sort({ storedYear: -1, storedMonth: -1 });
      let coveredFrom = Infinity;
      try {
        // Validate every stored numeric period, including history outside the
        // current graph clock, without retaining the period catalog in JS.
        for await (const row of rows) {
          const year = row.storedYear,
            month = row.storedMonth;
          if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) continue;
          const identity = year * 12 + month;
          if (identity >= coveredFrom) continue;
          const periods = periodWindow(year, month);
          const reference = periods.map(() => CATEGORIES.map(() => 0));
          for (const [category, { field }] of CATEGORIES.entries()) {
            const result = await summaries
              .aggregate(
                [
                  { $match: { ...predicate(scope), $or: periods } },
                  { $project: { year: 1, month: 1, value: `$${field}` } },
                  { $unwind: "$value" },
                  { $group: { _id: { year: "$year", month: "$month", value: "$value" } } },
                  { $group: { _id: { year: "$_id.year", month: "$_id.month" }, count: { $sum: 1 } } },
                ],
                options()
              )
              .toArray();
            for (const [index, period] of periods.entries())
              reference[index][category] =
                result.find((item) => item._id.year === period.year && item._id.month === period.month)?.count ?? 0;
          }
          budget.serialized(BSON.serialize({ reference }).length * 4 + 65536);
          const facts = await reader.read(
            {
              route: "patients-graphs/build-prepared-validation",
              backendMode: "candidate-validation",
              clock,
              timeZone: "UTC",
              timeoutMS: Math.min(60000, budget.check()),
            },
            ({ monthFacts }) => monthFacts(preparedKind(typed) ? typed : predicate(scope), periods)
          );
          for (const [index, counts] of reference.entries())
            for (const [category, expected] of counts.entries()) {
              if (facts.counts[index][category] !== expected)
                throw new Error("Prepared stored-month differential validation failed");
              cells += 1;
            }
          coveredFrom = identity - 11;
          windows += 1;
        }
      } finally {
        await rows.close();
      }
      scopes += 1;
    }
  } finally {
    await cursor.close();
  }
  return {
    equal: true,
    setsEqual: true,
    categories: 15,
    scopes,
    cells,
    setBlocks,
    windows,
    scope: "all-observed-single-field-equalities-and-national",
  };
}

// Compare exact bitmap contents with independent selections from historical
// atoms, including nonpresentable original periods. Equal counts alone cannot
// establish that the prepared patient set is the right set.
async function validateScopeSets({ db, generationId, scope, budget, collation }) {
  const native = codec();
  function stream(collection, match) {
    const cursor = db.collection(collection).aggregate(
      [
        { $match: match },
        {
          $project: {
            rowId: 1,
            period: {
              $cond: [
                "$graphVisible",
                { year: { $toDouble: "$storedYear" }, month: { $toDouble: "$storedMonth" } },
                { original: "$periodKey" },
              ],
            },
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.chunks,
            localField: "rowId",
            foreignField: "setId",
            pipeline: [{ $match: { generationId, category: { $in: CATEGORIES.map(({ id }) => id) } } }],
            as: "parts",
          },
        },
        { $unwind: "$parts" },
        { $project: { _id: 0, period: 1, chunk: "$parts" } },
        { $sort: { "chunk.block": 1, period: 1, "chunk.category": 1, "chunk.setId": 1, "chunk.chunkNo": 1 } },
      ],
      budget.options({ collation, promoteLongs: false, allowDiskUse: false })
    );
    let pending;
    return {
      close: () => cursor.close(),
      async next() {
        let document = pending ?? (await cursor.next());
        pending = undefined;
        if (!document) return;
        const keyFor = (row) =>
          BSON.serialize({ block: row.chunk.block, period: row.period, category: row.chunk.category });
        const key = keyFor(document);
        const bitmap = budget.bitmap(() => new native.RoaringBitmap32());
        try {
          while (document) {
            if (!key.equals(keyFor(document))) {
              pending = document;
              break;
            }
            const part = decodeChunk(document.chunk, budget);
            try {
              bitmap.orInPlace(part);
            } finally {
              part.dispose();
            }
            budget.native(native.getRoaringUsedMemory());
            document = await cursor.next();
          }
          return { key, bitmap };
        } catch (error) {
          bitmap.dispose();
          throw error;
        }
      },
    };
  }
  const expected = stream(COLLECTIONS.months, { generationId, ...predicate(scope), periodKind: "stored" });
  const prepared = stream(COLLECTIONS.monthScopes, { generationId, scopeId: scope.scopeId, periodKind: "stored" });
  let blocks = 0;
  try {
    for (;;) {
      const left = await expected.next();
      let right;
      try {
        right = await prepared.next();
        if (!left && !right) break;
        if (!left || !right || !left.key.equals(right.key) || !left.bitmap.isEqual(right.bitmap))
          throw new Error("Prepared stored-month exact set validation failed");
        blocks += 1;
      } finally {
        left?.bitmap.dispose();
        right?.bitmap.dispose();
      }
    }
  } finally {
    await expected.close();
    await prepared.close();
  }
  return blocks;
}

module.exports = {
  buildScopeCatalog,
  lookupPreparedScope,
  buildPreparedScopes,
  calculatePreparedMonths,
  validatePreparedScopes,
};
