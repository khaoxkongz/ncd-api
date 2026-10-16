const { createHash, randomUUID } = require("node:crypto");
const { BSON, Binary } = require("mongodb");
const { CATEGORIES, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { verifySelectedSets, verifyChunkDirectory } = require("./selected-sets");
const { codec, writeChunks, decodeChunk } = require("./bitmap");
const { calculatePreparedMonths } = require("./prepared-scopes");

const GEOGRAPHY = ["hcode", "area", "province", "district"];

function storedPeriods(clock) {
  const month = clock.getMonth() + 1;
  const year = clock.getFullYear();
  return periodWindow(year, month);
}

function periodWindow(year, month) {
  return Array.from({ length: 12 }, (_, index) => {
    const offset = month - 11 + index;
    return offset > 0 ? { year, month: offset } : { year: year - 1, month: offset + 12 };
  });
}

// Private Builder stage. BSON bytes distinguish typed period/geography tuples;
// overpartitioning Mongo-equivalent tuples is safe because reads union all
// eligible contributions. Patient identity remains the Mongo dictionary class.
async function buildStoredMonths({
  db,
  summaries,
  edges,
  generationId,
  prefix,
  budget,
  collation,
  indexSuffix,
  measureStorage,
}) {
  const atoms = db.collection(COLLECTIONS.months);
  const rows = db.collection(`${prefix}_month_rows`);
  const monthEdges = db.collection(`${prefix}_month_edges`);
  const options = (extra = {}) => budget.options({ collation, ...extra });
  await atoms.createIndex({ generationId: 1, periodKind: 1, periodKey: 1, partitionId: 1 }, { unique: true });
  await atoms.createIndex({ generationId: 1, rowId: 1 }, { unique: true });
  try {
    const cursor = summaries.find({}, options({ ...BSON_OPTIONS }));
    try {
      for await (const summary of cursor) {
        const period = Object.fromEntries(
          ["year", "month"].filter((field) => Object.hasOwn(summary, field)).map((field) => [field, summary[field]])
        );
        const geography = Object.fromEntries(
          GEOGRAPHY.filter((field) => Object.hasOwn(summary, field)).map((field) => [field, summary[field]])
        );
        const periodKey = new Binary(BSON.serialize(period));
        const partitionId = new Binary(BSON.serialize(geography));
        // Use the same default driver promotion as the graph presenters before
        // their strict === numeric-period comparison. Decimal128 stays an object.
        const promoted = BSON.deserialize(BSON.serialize(period));
        const graphVisible = typeof promoted.year === "number" && typeof promoted.month === "number";
        const metadata = {
          generationId,
          rowId: `stored-${randomUUID()}`,
          periodKind: "stored",
          periodKey,
          partitionId,
          ...geography,
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
        budget.serialized(BSON.serialize(metadata).length * 4 + 65536);
        const atom = await atoms.findOneAndUpdate(
          { generationId, periodKind: "stored", periodKey, partitionId },
          { $setOnInsert: metadata, $inc: { matchedRows: 1 } },
          options({ upsert: true, returnDocument: "after" })
        );
        await rows.insertOne({ rowId: summary.modelRowId, setId: atom.rowId });
      }
    } finally {
      await cursor.close();
    }
    await rows.createIndex({ rowId: 1 }, { unique: true });
    const members = edges.aggregate(
      [
        { $match: { generationId, category: { $in: CATEGORIES.map(({ id }) => id) } } },
        { $lookup: { from: rows.collectionName, localField: "setId", foreignField: "rowId", as: "atom" } },
        { $unwind: "$atom" },
        { $project: { _id: 0, generationId: 1, setId: "$atom.setId", category: 1, block: 1, offset: 1 } },
      ],
      options({ ...BSON_OPTIONS })
    );
    try {
      for await (const member of members) {
        budget.serialized(BSON.serialize(member).length * 4 + 65536);
        await monthEdges.insertOne(member);
      }
    } finally {
      await members.close();
    }
    await monthEdges.createIndex({ setId: 1, category: 1, block: 1, offset: 1 });
    await writeChunks({
      edges: monthEdges,
      chunks: db.collection(COLLECTIONS.chunks),
      directory: db.collection(COLLECTIONS.directory),
      daily: atoms,
      generationId,
      budget,
    });
    // Only present memberships can participate in a graph's numeric group.
    // Mixed BSON kinds in different categories (or empty rows) are stable.
    // A visible/nonvisible mixture within one category and numeric period has
    // an unstable group representative, so fail the entire candidate.
    const numeric = ["int", "long", "double", "decimal"];
    const ambiguous = await atoms
      .aggregate(
        [
          {
            $match: {
              generationId,
              $expr: {
                $and: [{ $in: [{ $type: "$storedYear" }, numeric] }, { $in: [{ $type: "$storedMonth" }, numeric] }],
              },
            },
          },
          {
            $project: {
              storedYear: 1,
              storedMonth: 1,
              graphVisible: 1,
              categories: CATEGORIES.map(({ id }) => ({ id, cardinality: `$members.${id}.cardinality` })),
            },
          },
          { $unwind: "$categories" },
          { $match: { "categories.cardinality": { $gt: 0 } } },
          {
            $group: {
              _id: { year: "$storedYear", month: "$storedMonth", category: "$categories.id" },
              visible: { $min: "$graphVisible" },
              other: { $max: "$graphVisible" },
            },
          },
          { $match: { $expr: { $ne: ["$visible", "$other"] } } },
          {
            $match: {
              "_id.month": { $gte: 1, $lte: 12 },
              "_id.year": { $gte: Number.MIN_SAFE_INTEGER, $lte: Number.MAX_SAFE_INTEGER },
              $expr: {
                $and: [
                  { $eq: ["$_id.year", { $trunc: "$_id.year" }] },
                  { $eq: ["$_id.month", { $trunc: "$_id.month" }] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        options()
      )
      .toArray();
    if (ambiguous.length) throw new Error("Unstable baseline BSON stored-period presentation");
    await atoms.createIndex(
      { generationId: 1, periodKind: 1, storedYear: 1, storedMonth: 1 },
      { collation, partialFilterExpression: { graphVisible: true }, name: `patients_month_period_${indexSuffix}` }
    );
    for (const field of GEOGRAPHY)
      await atoms.createIndex(
        { generationId: 1, periodKind: 1, [field]: 1, storedYear: 1, storedMonth: 1 },
        { collation, partialFilterExpression: { graphVisible: true }, name: `patients_month_${field}_${indexSuffix}` }
      );
    await measureStorage();
  } finally {
    await rows.drop();
    await monthEdges.drop();
  }
  return atoms.countDocuments({ generationId }, options());
}

async function calculateMonths({ db, generation, scope, periods, budget }) {
  if (!generation.components.monthlyStored?.complete) throw new Error("Incomplete stored-month component");
  const generationId = generation.generationId;
  const atoms = db.collection(COLLECTIONS.months),
    chunks = db.collection(COLLECTIONS.chunks),
    directory = db.collection(COLLECTIONS.directory);
  const options = (extra = {}) => budget.options({ collation: generation.collation, ...extra });
  if (
    (await atoms.countDocuments({ generationId }, options())) !== generation.inventory.storedAtoms ||
    (await chunks.countDocuments({ generationId }, options())) !== generation.inventory.chunks ||
    (await directory.countDocuments({ generationId }, options())) !== generation.inventory.directories
  )
    throw new Error("Stored-month generation inventory changed");
  const prepared = await calculatePreparedMonths({ db, generation, scope, periods, budget });
  if (prepared) return prepared;
  const match = {
    ...scope,
    generationId,
    periodKind: "stored",
    graphVisible: true,
    $or: periods.map(({ year, month }) => ({ storedYear: year, storedMonth: month })),
  };
  await verifySelectedSets({
    db,
    generationId,
    selections: [{ collection: COLLECTIONS.months, match }],
    categories: CATEGORIES.map(({ id }) => id),
    budget,
    collation: generation.collation,
  });
  const grouped = await atoms
    .aggregate(
      [
        { $match: match },
        {
          $group: {
            _id: { year: "$storedYear", month: "$storedMonth" },
            atoms: { $sum: 1 },
            matchedRows: { $sum: "$matchedRows" },
            ...Object.fromEntries(
              CATEGORIES.flatMap(({ id }) => [
                [`${id}_chunks`, { $sum: `$members.${id}.chunks` }],
                [`${id}_members`, { $sum: `$members.${id}.cardinality` }],
                [
                  `${id}_inventories`,
                  { $sum: { $cond: [{ $eq: [{ $type: `$members.${id}.chunks` }, "missing"] }, 0, 1] } },
                ],
              ])
            ),
          },
        },
      ],
      options()
    )
    .toArray();
  const expected = periods.map(({ year, month }) =>
    grouped.find((row) => row._id.year === year && row._id.month === month)
  );
  for (const row of expected)
    for (const { id } of CATEGORIES)
      if ((row?.[`${id}_inventories`] ?? 0) !== (row?.atoms ?? 0))
        throw new Error("Missing stored-month set inventory");
  const counts = periods.map(() => CATEGORIES.map(() => 0));
  const readChunks = periods.map(() => CATEGORIES.map(() => 0)),
    readMembers = periods.map(() => CATEGORIES.map(() => 0));
  const cursor = atoms.aggregate(
    [
      { $match: match },
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
      {
        $replaceWith: {
          $mergeObjects: ["$parts", { eligible: { storedYear: "$storedYear", storedMonth: "$storedMonth" } }],
        },
      },
      {
        $lookup: {
          from: COLLECTIONS.directory,
          let: { setId: "$setId", category: "$category", block: "$block", chunkNo: "$chunkNo" },
          pipeline: [
            {
              $match: {
                generationId,
                $expr: {
                  $and: [
                    { $eq: ["$setId", "$$setId"] },
                    { $eq: ["$category", "$$category"] },
                    { $eq: ["$block", "$$block"] },
                    { $eq: ["$chunkNo", "$$chunkNo"] },
                  ],
                },
              },
            },
          ],
          as: "directory",
        },
      },
      { $sort: { block: 1, "eligible.storedYear": 1, "eligible.storedMonth": 1, category: 1, setId: 1, chunkNo: 1 } },
    ],
    options({ promoteLongs: false, allowDiskUse: false })
  );
  const native = codec();
  const bitmap = budget.bitmap(() => new native.RoaringBitmap32());
  let current;
  function finish() {
    if (!current) return;
    counts[current.month][current.category] += bitmap.size;
    if (!Number.isSafeInteger(counts[current.month][current.category])) throw new Error("Unsafe exact graph count");
    bitmap.clear();
  }
  try {
    for await (const document of cursor) {
      const month = periods.findIndex(
        ({ year, month }) =>
          year === Number(document.eligible.storedYear) && month === Number(document.eligible.storedMonth)
      );
      const category = CATEGORIES.findIndex(({ id }) => id === document.category);
      if (month < 0 || category < 0) throw new Error("Missing or changed stored-month directory entry");
      verifyChunkDirectory(document);
      if (
        current &&
        (!current.block.equals(document.block) || current.month !== month || current.category !== category)
      )
        finish();
      current = { month, category, block: document.block };
      readChunks[month][category] += 1;
      readMembers[month][category] += document.popcount;
      delete document.eligible;
      const contribution = decodeChunk(document, budget);
      try {
        bitmap.orInPlace(contribution);
      } finally {
        contribution.dispose();
      }
      budget.native(native.getRoaringUsedMemory());
    }
    finish();
    for (const [month, row] of expected.entries())
      for (const [category, { id }] of CATEGORIES.entries())
        if (
          readChunks[month][category] !== (row?.[`${id}_chunks`] ?? 0) ||
          readMembers[month][category] !== (row?.[`${id}_members`] ?? 0)
        )
          throw new Error("Missing or extra stored-month chunks");
  } finally {
    await cursor.close();
    bitmap.dispose();
  }
  return Object.freeze({
    counts: Object.freeze(counts.map(Object.freeze)),
    periods: Object.freeze(periods.map((period) => Object.freeze({ ...period }))),
    categories: Object.freeze(CATEGORIES.map(({ id }) => id)),
  });
}

async function validateStoredMonths({ db, summaries, generationId, budget, collation, clock }) {
  const reader = require("./reader").createReader({ db, generationId, validationOnly: true });
  const options = () => budget.options({ collation, allowDiskUse: false });
  let windows = 0;
  async function compare(periods) {
    const expected = periods.map(() => CATEGORIES.map(() => 0));
    for (const [column, { field }] of CATEGORIES.entries()) {
      // Independent baseline graph relation: direct unwind, distinct
      // (stored period, original member), then the presenter's strict match.
      const result = await summaries
        .aggregate(
          [
            { $match: { $or: periods } },
            { $project: { year: 1, month: 1, value: `$${field}` } },
            { $unwind: "$value" },
            { $group: { _id: { year: "$year", month: "$month", value: "$value" } } },
            { $group: { _id: { year: "$_id.year", month: "$_id.month" }, count: { $sum: 1 } } },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
          ],
          options()
        )
        .toArray();
      for (const [row, { year, month }] of periods.entries())
        expected[row][column] = result.find((item) => item._id.year === year && item._id.month === month)?.count ?? 0;
    }
    const facts = await reader.read(
      {
        route: "patients-graphs/build-validation",
        backendMode: "candidate-validation",
        clock,
        timeZone: "UTC",
        timeoutMS: Math.min(60000, budget.check()),
      },
      ({ monthFacts }) => monthFacts({}, periods)
    );
    if (!BSON.serialize({ counts: facts.counts }).equals(BSON.serialize({ counts: expected })))
      throw new Error("Stored-month graph differential validation failed");
    windows += 1;
  }
  const initial = storedPeriods(clock);
  await compare(initial);
  // Cover all original supported stored periods, including ones that disagree
  // with summary dates or the source-cut clock. No full period inventory in JS.
  const cursor = summaries.aggregate(
    [
      { $project: { year: 1, month: 1 } },
      { $unwind: "$year" },
      { $unwind: "$month" },
      {
        $match: {
          $expr: {
            $and: [
              { $in: [{ $type: "$year" }, ["int", "long", "double", "decimal"]] },
              { $in: [{ $type: "$month" }, ["int", "long", "double", "decimal"]] },
            ],
          },
        },
      },
      { $group: { _id: { year: "$year", month: "$month" } } },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
    ],
    options()
  );
  let coveredFrom = Infinity;
  try {
    for await (const { _id } of cursor) {
      const year = _id.year?._bsontype === "Decimal128" ? Number(_id.year.toString()) : _id.year;
      const month = _id.month?._bsontype === "Decimal128" ? Number(_id.month.toString()) : _id.month;
      if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || month < 1 || month > 12) continue;
      const identity = year * 12 + month;
      if (identity >= coveredFrom || initial.some((period) => period.year === year && period.month === month)) continue;
      await compare(periodWindow(year, month));
      coveredFrom = identity - 11;
    }
  } finally {
    await cursor.close();
  }
  return { equal: true, categories: 15, windows, scope: "all-supported-stored-periods" };
}

module.exports = { storedPeriods, periodWindow, buildStoredMonths, calculateMonths, validateStoredMonths };
