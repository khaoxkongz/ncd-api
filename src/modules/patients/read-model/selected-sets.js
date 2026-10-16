const { createHash } = require("node:crypto");
const { BSON } = require("mongodb");
const { COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { directoryToken } = require("./bitmap");

// Only selected metadata and independent directory headers are streamed. Two
// bounded cursors retain one metadata row and one set/category digest, including
// explicit empty inventories; payload decoding remains the caller's operation.
async function verifySelectedSets({ db, generationId, selections, categories, budget, collation }) {
  const options = budget.options({ collation, ...BSON_OPTIONS, allowDiskUse: false });
  const metadata = (match) => [{ $match: match }, { $project: { rowId: 1, members: 1 } }];
  const headers = (match) => [
    { $match: match },
    {
      $lookup: {
        from: COLLECTIONS.directory,
        localField: "rowId",
        foreignField: "setId",
        pipeline: [{ $match: { generationId, category: { $in: categories } } }],
        as: "parts",
      },
    },
    { $unwind: "$parts" },
    { $replaceWith: "$parts" },
  ];
  function pipeline(make, sort) {
    const [first, ...rest] = selections;
    return [
      ...make(first.match),
      ...rest.map(({ collection, match }) => ({ $unionWith: { coll: collection, pipeline: make(match) } })),
      { $sort: sort },
    ];
  }
  const source = db.collection(selections[0].collection);
  const rows = source.aggregate(pipeline(metadata, { rowId: 1 }), options);
  const directory = source.aggregate(pipeline(headers, { setId: 1, category: 1, block: 1, chunkNo: 1 }), options);
  const allowed = new Set(categories),
    emptyDigest = createHash("sha256").digest("hex");
  let next;
  function inventory(row, id) {
    const value = row.members?.[id];
    if (
      !value ||
      !/^[a-f0-9]{64}$/.test(value.directorySha256) ||
      [value.chunks, value.cardinality].some(
        (n) => typeof n === "string" || !Number.isSafeInteger(Number(n)) || Number(n) < 0
      ) ||
      (Number(value.chunks) === 0) !== (Number(value.cardinality) === 0)
    )
      throw new Error("Missing selected set inventory");
    return value;
  }
  try {
    next = await directory.next();
    for await (const row of rows) {
      budget.serialized(BSON.serialize(row).length * 4 + 65536);
      const seen = new Set();
      while (next && next.setId === row.rowId) {
        const id = next.category;
        if (!allowed.has(id) || seen.has(id)) throw new Error("Unexpected selected set directory");
        const expected = inventory(row, id),
          digest = createHash("sha256");
        let chunks = 0,
          members = 0;
        do {
          budget.serialized(BSON.serialize(next).length * 4 + 65536);
          digest.update(directoryToken(next));
          chunks += 1;
          members += Number(next.popcount);
          if (!Number.isSafeInteger(members)) throw new Error("Unsafe selected member inventory");
          next = await directory.next();
        } while (next && next.setId === row.rowId && next.category === id);
        if (
          digest.digest("hex") !== expected.directorySha256 ||
          chunks !== Number(expected.chunks) ||
          members !== Number(expected.cardinality)
        )
          throw new Error("Changed selected set directory");
        seen.add(id);
      }
      for (const id of categories)
        if (!seen.has(id)) {
          const expected = inventory(row, id);
          if (
            Number(expected.chunks) !== 0 ||
            Number(expected.cardinality) !== 0 ||
            expected.directorySha256 !== emptyDigest
          )
            throw new Error("Missing selected set directory");
        }
    }
    if (next) throw new Error("Extra selected set directory");
  } finally {
    await rows.close();
    await directory.close();
  }
}

function verifyChunkDirectory(document) {
  if (
    !Array.isArray(document.directory) ||
    document.directory.length !== 1 ||
    !directoryToken(document).equals(directoryToken(document.directory[0]))
  )
    throw new Error("Missing or changed chunk directory entry");
  delete document.directory;
}

module.exports = { verifySelectedSets, verifyChunkDirectory };
