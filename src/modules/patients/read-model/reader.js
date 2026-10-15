const { BSON } = require("mongodb");
const { createBudget } = require("./budget");
const { CATEGORIES, VERSIONS, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { codec, directoryToken, decodeChunk } = require("./bitmap");

function compatible(versions) {
  return (
    versions &&
    Object.keys(versions).length === Object.keys(VERSIONS).length &&
    Object.entries(VERSIONS).every(([key, value]) => versions[key] === value)
  );
}

function createReader({ db, generationId, validationOnly = false }) {
  if (!db || !generationId) throw new Error("An explicit Mongo adapter and generation are required");
  const inFlight = [];
  return Object.freeze({
    async read(requestContext, callback) {
      if (!validationOnly || requestContext?.backendMode !== "candidate-validation")
        throw new Error("Incomplete generation is unavailable for serving");
      if (
        typeof requestContext.route !== "string" ||
        !(requestContext.clock instanceof Date) ||
        !Number.isFinite(requestContext.clock.getTime()) ||
        typeof requestContext.timeZone !== "string"
      )
        throw new Error("A captured route, clock and server timezone are required");
      const requestBudget = createBudget(
        { maxTimeMS: requestContext.timeoutMS ?? 60000 },
        { request: true, signal: requestContext.signal }
      );
      const generations = db.collection(COLLECTIONS.generations),
        daily = db.collection(COLLECTIONS.daily),
        chunks = db.collection(COLLECTIONS.chunks),
        directory = db.collection(COLLECTIONS.directory);
      const generation = await generations.findOne({ _id: generationId }, requestBudget.options());
      if (generation) requestBudget.serialized(BSON.serialize(generation).length * 4 + 65536);
      if (
        !generation ||
        generation.generationId !== generationId ||
        generation.state !== "candidate-partial" ||
        !generation.components.patientsBar.complete ||
        !compatible(generation.versions)
      )
        throw new Error("Incomplete or incompatible Patients Bar component");
      const collation = generation.collation;
      const options = (budget, extra = {}) => budget.options({ collation, ...extra });
      async function calculateRange(selection, budget) {
        const match = { ...selection, generationId };
        const chunkCount = await chunks.countDocuments({ generationId }, options(budget));
        const rowCount = await daily.countDocuments({ generationId }, options(budget));
        const directoryCount = await directory.countDocuments({ generationId }, options(budget));
        if (
          chunkCount !== generation.inventory.chunks ||
          rowCount !== generation.inventory.rows ||
          directoryCount !== generation.inventory.directories
        )
          throw new Error("Generation row or chunk inventory changed");
        // Read selected daily metadata once. The six totals below bind the
        // subsequent stream to every expected set contribution, including empty
        // sets and scalar-only matched rows, without one cursor per row/category.
        const grouped = await daily
          .aggregate(
            [
              { $match: match },
              {
                $group: {
                  _id: null,
                  matchedRows: { $sum: 1 },
                  ...Object.fromEntries(
                    CATEGORIES.slice(0, 6).flatMap(({ id, service }) => [
                      [service, { $sum: `$${service}` }],
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
            options(budget)
          )
          .toArray();
        const matchedRows = grouped[0]?.matchedRows ?? 0;
        for (const { id } of CATEGORIES.slice(0, 6))
          if ((grouped[0]?.[`${id}_inventories`] ?? 0) !== matchedRows) throw new Error("Missing set inventory");
        const services = CATEGORIES.slice(0, 6).map(({ service }) => grouped[0]?.[service] ?? 0);
        const counts = [0, 0, 0, 0, 0, 0];
        const native = codec();
        const bitmaps = counts.map(() => new native.RoaringBitmap32());
        const categoryIndex = new Map(CATEGORIES.slice(0, 6).map(({ id }, index) => [id, index]));
        const readChunks = counts.map(() => 0),
          readMembers = counts.map(() => 0);
        const cursor = chunks.aggregate(
          [
            { $match: { generationId, category: { $in: CATEGORIES.slice(0, 6).map(({ id }) => id) } } },
            {
              $lookup: {
                from: COLLECTIONS.daily,
                localField: "setId",
                foreignField: "rowId",
                pipeline: [{ $match: match }, { $project: { _id: 1 } }],
                as: "eligible",
              },
            },
            { $match: { "eligible.0": { $exists: true } } },
            { $project: { eligible: 0 } },
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
            { $sort: { block: 1, category: 1, setId: 1, chunkNo: 1 } },
          ],
          options(budget, { promoteLongs: false, allowDiskUse: false })
        );
        let block;
        function finishBlock() {
          for (let i = 0; i < bitmaps.length; i += 1) {
            counts[i] += bitmaps[i].size;
            bitmaps[i].clear();
            if (!Number.isSafeInteger(counts[i])) throw new Error("Unsafe exact patient count");
          }
        }
        try {
          for await (const document of cursor) {
            if (
              document.directory.length !== 1 ||
              !directoryToken(document).equals(directoryToken(document.directory[0]))
            )
              throw new Error("Missing or changed chunk directory entry");
            const index = categoryIndex.get(document.category);
            readChunks[index] += 1;
            readMembers[index] += document.popcount;
            delete document.directory;
            if (block && !block.equals(document.block)) finishBlock();
            block = document.block;
            const bitmap = decodeChunk(document, budget);
            try {
              bitmaps[index].orInPlace(bitmap);
            } finally {
              bitmap.dispose();
            }
            budget.native(native.getRoaringUsedMemory());
          }
          finishBlock();
          for (const [index, { id }] of CATEGORIES.slice(0, 6).entries())
            if (
              readChunks[index] !== (grouped[0]?.[`${id}_chunks`] ?? 0) ||
              readMembers[index] !== (grouped[0]?.[`${id}_members`] ?? 0)
            )
              throw new Error("Missing or extra selected chunks");
        } finally {
          await cursor.close();
          for (const bitmap of bitmaps) bitmap.dispose();
        }
        return Object.freeze({
          counts,
          services,
          matchedRows,
          empty: matchedRows === 0,
          // Original operands stream once per consumer inside the read callback.
          // #20 can apply expense-v1 without narrowing BSON or materializing rows.
          expenseOperands: {
            async *[Symbol.asyncIterator]() {
              const cursor = daily.find(
                match,
                options(budget, {
                  ...BSON_OPTIONS,
                  projection: {
                    _id: 0,
                    ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ expense }) => [expense, 1])),
                  },
                })
              );
              try {
                for await (const row of cursor) {
                  budget.check();
                  yield CATEGORIES.slice(0, 6).map(({ expense }) =>
                    Object.hasOwn(row, expense) ? { present: true, value: row[expense] } : { present: false }
                  );
                }
              } finally {
                await cursor.close();
              }
            },
          },
          source: {
            sourceCutAt: generation.source.sourceCutAt,
            state: generation.source.rawComplete
              ? requestContext.clock - new Date(generation.source.sourceCutAt) <= 86400000
                ? "fresh"
                : "stale"
              : "unknown",
          },
        });
      }
      async function rangeFacts(selection) {
        requestBudget.check();
        // BSON bytes are a lossless typed query key. Equality compares the full
        // bytes, not a hash, JS object identity, or a JSON conversion.
        const key = BSON.serialize({
          generationId,
          versions: VERSIONS,
          route: requestContext.route,
          backendMode: requestContext.backendMode,
          timeoutMS: requestContext.timeoutMS ?? 60000,
          selection,
        });
        requestBudget.serialized(key.length);
        let entry = inFlight.find((item) => item.key.equals(key));
        if (!entry) {
          if (inFlight.length >= 64) throw new Error("Range work coordination limit exceeded");
          const budget = createBudget({ maxTimeMS: requestContext.timeoutMS ?? 60000 }, { request: true });
          entry = { key };
          entry.promise = calculateRange(selection, budget).finally(() => {
            const index = inFlight.indexOf(entry);
            if (index >= 0) inFlight.splice(index, 1);
          });
          inFlight.push(entry);
        }
        const result = await entry.promise;
        requestBudget.check();
        return result;
      }
      const unavailable = async () => {
        throw new Error("Read-model component is incomplete");
      };
      const result = await callback(Object.freeze({ rangeFacts, monthFacts: unavailable, snapshot: unavailable }));
      requestBudget.check();
      return result;
    },
  });
}

module.exports = { createReader };
