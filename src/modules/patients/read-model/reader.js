const { BSON } = require("mongodb");
const { createBudget } = require("./budget");
const { CATEGORIES, VERSIONS, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { codec, directoryToken, decodeChunk } = require("./bitmap");
const { calculateMonths } = require("./stored-months");
const expense = require("./expense");
const card = require("./daily-card");
const { calculateDateRange, validateServiceFacts } = require("./date-months");
const { generationProvenance, sourceState } = require("./metadata");
const { readSnapshot } = require("./snapshots");

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
      if (
        requestContext.route.startsWith("expense-bar/") &&
        (!generation.components.expenseBar?.complete || generation.components.expenseBar.generationId !== generationId)
      )
        throw new Error("Incomplete or incompatible expense Bar component");
      if (
        requestContext.route.startsWith("card/") &&
        ["card", "hospitalDictionary"].some(
          (name) => !generation.components[name]?.complete || generation.components[name].generationId !== generationId
        )
      )
        throw new Error("Incomplete or incompatible Card component");
      const collation = generation.collation;
      const options = (budget, extra = {}) => budget.options({ collation, ...extra });
      async function calculateRange(selection, budget) {
        const monthly = await calculateDateRange({ db, generation, selection, budget });
        if (monthly) return monthly;
        const match = { ...selection, generationId };
        const rangeSets = [...CATEGORIES.slice(0, 6).map(({ id }) => id), ...card.SETS];
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
                  cardService: { $sum: "$card.service" },
                  cardServiceErrors: { $sum: { $cond: [{ $eq: ["$card.serviceState", "error"] }, 1, 0] } },
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
                  ...Object.fromEntries(
                    card.SETS.flatMap((id) => [
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
        for (const id of rangeSets)
          if ((grouped[0]?.[`${id}_inventories`] ?? 0) !== matchedRows) throw new Error("Missing set inventory");
        const services = CATEGORIES.slice(0, 6).map(({ service }) => grouped[0]?.[service] ?? 0);
        const counts = rangeSets.map(() => 0);
        const native = codec();
        const bitmaps = counts.map(() => new native.RoaringBitmap32());
        const categoryIndex = new Map(rangeSets.map((id, index) => [id, index]));
        const readChunks = counts.map(() => 0),
          readMembers = counts.map(() => 0);
        const cursor = chunks.aggregate(
          [
            { $match: { generationId, category: { $in: rangeSets } } },
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
          for (const [index, id] of rangeSets.entries())
            if (
              readChunks[index] !== (grouped[0]?.[`${id}_chunks`] ?? 0) ||
              readMembers[index] !== (grouped[0]?.[`${id}_members`] ?? 0)
            )
              throw new Error("Missing or extra selected chunks");
        } finally {
          await cursor.close();
          for (const bitmap of bitmaps) bitmap.dispose();
        }
        const expenseTotals = Array(6).fill(expense.ZERO);
        const expenseCursor = daily.find(
          match,
          options(budget, {
            ...BSON_OPTIONS,
            projection: {
              _id: 0,
              rowId: 1,
              expenses: 1,
              expenseVersion: 1,
              expenseSha256: 1,
              card: 1,
              dailyServiceSha256: 1,
              ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ service }) => [service, 1])),
            },
          })
        );
        let expenseRows = 0;
        try {
          for await (const row of expenseCursor) {
            budget.serialized(BSON.serialize(row).length * 4 + 65536);
            validateServiceFacts(row);
            // Read the Card scalar under the same original BSON types used to
            // seal it. Aggregation above retains baseline driver promotion.
            if (
              !row.card ||
              row.card.version !== card.VERSION ||
              row.card.sha256 !== card.checksum(row.rowId, row.card)
            )
              throw new Error("Missing or changed Card facts");
            // Exact decimals are represented as strings plus integer scales;
            // driver numeric wrappers must not alter that application schema.
            row.expenses = row.expenses?.map((value) => ({ ...value, scale: Number(value.scale) }));
            if (
              row.expenseVersion !== expense.VERSION ||
              !Array.isArray(row.expenses) ||
              row.expenses.length !== 6 ||
              row.expenseSha256 !== expense.checksum(row.rowId, row.expenses)
            )
              throw new Error("Missing or incompatible exact expense facts");
            for (let index = 0; index < 6; index += 1)
              expenseTotals[index] = expense.add(expenseTotals[index], row.expenses[index]);
            expenseRows += 1;
          }
          if (expenseRows !== matchedRows) throw new Error("Exact expense row inventory changed");
        } finally {
          await expenseCursor.close();
        }
        return Object.freeze({
          counts: counts.slice(0, 6),
          cardPatientCount: counts[6],
          hospitalCount: counts[7],
          cardService: grouped[0]?.cardService ?? 0,
          cardServiceError: (grouped[0]?.cardServiceErrors ?? 0) > 0,
          services,
          expenseTotals: Object.freeze(expenseTotals),
          matchedRows,
          empty: matchedRows === 0,
          // Original BSON operands remain available for validation/audit;
          // arithmetic uses the canonical unrounded expenseTotals above.
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
        });
      }
      async function rangeFacts(selection) {
        requestBudget.check();
        // BSON bytes are a lossless typed query key. Equality compares the full
        // bytes, not a hash, JS object identity, or a JSON conversion.
        const key = BSON.serialize({
          generationId,
          versions: VERSIONS,
          route: requestContext.rangeRoute ?? requestContext.route,
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
        // Calculation facts can be shared across equivalent live adapters;
        // freshness belongs to each caller's captured clock and source state.
        return Object.freeze({
          ...result,
          source: sourceState(generationProvenance(generation), requestContext.clock),
        });
      }
      async function monthFacts(scope, periods) {
        requestBudget.check();
        if (
          !scope ||
          !Array.isArray(periods) ||
          periods.length !== 12 ||
          periods.some(
            ({ year, month }, index) =>
              !Number.isSafeInteger(year) ||
              !Number.isSafeInteger(month) ||
              month < 1 ||
              month > 12 ||
              (index > 0 && year * 12 + month !== periods[index - 1].year * 12 + periods[index - 1].month + 1)
          )
        )
          throw new Error("Twelve ordered numeric stored periods are required");
        const key = BSON.serialize({
          generationId,
          versions: VERSIONS,
          route: requestContext.route,
          backendMode: requestContext.backendMode,
          timeoutMS: requestContext.timeoutMS ?? 60000,
          timeZone: requestContext.timeZone,
          scope,
          periods,
        });
        requestBudget.serialized(key.length);
        let entry = inFlight.find((item) => item.key.equals(key));
        if (!entry) {
          if (inFlight.length >= 64) throw new Error("Monthly work coordination limit exceeded");
          const budget = createBudget({ maxTimeMS: requestContext.timeoutMS ?? 60000 }, { request: true });
          entry = { key };
          entry.promise = calculateMonths({ db, generation, scope, periods, budget }).finally(() => {
            const index = inFlight.indexOf(entry);
            if (index >= 0) inFlight.splice(index, 1);
          });
          inFlight.push(entry);
        }
        const result = await entry.promise;
        requestBudget.check();
        return Object.freeze({
          ...result,
          source: sourceState(generationProvenance(generation), requestContext.clock),
        });
      }
      const snapshot = (endpoint) =>
        readSnapshot({ db, generation, endpoint, clock: requestContext.clock, budget: requestBudget });
      const result = await callback(Object.freeze({ rangeFacts, monthFacts, snapshot }));
      requestBudget.check();
      return result;
    },
  });
}

module.exports = { createReader };
