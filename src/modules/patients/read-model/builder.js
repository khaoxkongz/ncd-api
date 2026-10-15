const { randomUUID, createHash } = require("node:crypto");
const { BSON, Long } = require("mongodb");
const { pipeline } = require("../../migration/pipeline");
const { finalizeCid } = require("../../../lib/hash-cid");
const { createBudget } = require("./budget");
const { openSource } = require("./source");
const { CATEGORIES, VERSIONS, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { codec, ordinalParts, writeChunks } = require("./bitmap");
const { buildStoredMonths, validateStoredMonths } = require("./stored-months");
const { buildPreparedScopes, validatePreparedScopes } = require("./prepared-scopes");
const expense = require("./expense");
const { buildDailyCard, validateDailyCard } = require("./daily-card");

function createBuilder({ db }) {
  if (!db || typeof db.collection !== "function") throw new Error("An explicit Mongo adapter is required");
  let busy = false;
  return Object.freeze({
    async build(sourceCut, declaredBudget, comparisonContext = {}) {
      if (busy) throw new Error("A build is already running");
      const budget = createBudget(declaredBudget);
      busy = true;
      const generationId = randomUUID();
      const prefix = `patients_stage_${generationId.replaceAll("-", "")}`;
      const raw = db.collection(`${prefix}_raw`),
        summaries = db.collection(`${prefix}_summary`),
        values = db.collection(`${prefix}_values`),
        edges = db.collection(`${prefix}_edges`);
      const generations = db.collection(COLLECTIONS.generations),
        identity = db.collection(COLLECTIONS.identity),
        daily = db.collection(COLLECTIONS.daily),
        chunks = db.collection(COLLECTIONS.chunks);
      const directory = db.collection(COLLECTIONS.directory);
      let source;
      const stages = [];
      async function measureStorage() {
        let storage = source?.manifest.bytes ?? 0;
        const names = await db.listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of names) {
          if (Object.values(COLLECTIONS).includes(name) || name.startsWith(prefix)) {
            const stats = await db.command({ collStats: name });
            storage += stats.storageSize + stats.totalIndexSize;
          }
        }
        budget.storage(storage);
        budget.metrics.peakStorageBytes = Math.max(budget.metrics.peakStorageBytes ?? 0, storage);
      }
      async function stage(name, operation) {
        const started = budget.metrics.elapsedMS;
        await operation();
        budget.check();
        await measureStorage();
        stages.push({ name, complete: true, elapsedMS: budget.metrics.elapsedMS - started });
      }
      try {
        codec();
        source = await openSource(sourceCut, budget, comparisonContext);
        const manifest = source.manifest;
        const collation = manifest.collation;
        // This digest names a collation-specific index, never an identity.
        const indexSuffix = createHash("sha256").update(BSON.serialize(collation)).digest("hex").slice(0, 16);
        const options = (extra = {}) => budget.options({ collation, ...extra });
        await generations.insertOne({
          _id: generationId,
          generationId,
          state: "building",
          complete: false,
          versions: VERSIONS,
          source: manifest,
          budget: declaredBudget,
        });
        await stage("source-staging", async () => {
          await db.createCollection(raw.collectionName, { collation });
          for await (const document of source.documents()) await raw.insertOne(document);
        });
        const typeInventory = [];
        const expenseTypes = new Map();
        const expenseReference = Array(6).fill(expense.ZERO);
        await stage("source-type-inventory", async () => {
          const cursor = raw.aggregate(
            [
              { $project: { fields: { $objectToArray: "$$ROOT" } } },
              { $unwind: "$fields" },
              { $group: { _id: { field: "$fields.k", type: { $type: "$fields.v" } }, count: { $sum: 1 } } },
              { $sort: { "_id.field": 1, "_id.type": 1 } },
            ],
            options()
          );
          let bytes = 0;
          try {
            for await (const record of cursor) {
              bytes += BSON.serialize(record).length;
              budget.serialized(bytes);
              typeInventory.push(record);
            }
          } finally {
            await cursor.close();
          }
        });
        await stage("baseline-hospital-day-etl", async () => {
          await db.createCollection(summaries.collectionName, { collation });
          if (manifest.dataset === "summary-fixture") {
            const cursor = raw.find({}, options({ ...BSON_OPTIONS }));
            try {
              for await (const document of cursor) await summaries.insertOne(document);
            } finally {
              await cursor.close();
            }
          } else {
            if (typeof comparisonContext.identitySecret !== "string" || !comparisonContext.identitySecret)
              throw new Error("Baseline identity finalization secret is required");
            await summaries.createIndex({ hcode: 1, date: 1 }, { unique: true });
            for (
              let day = new Date(manifest.history.start);
              day <= new Date(manifest.history.end);
              day = new Date(day.getTime() + 86400000)
            ) {
              const end = new Date(day.getTime() + 86400000 - 1);
              const aggregation = pipeline(day, end, summaries.collectionName);
              await raw.aggregate(aggregation, options({ allowDiskUse: false })).toArray();
            }
          }
        });
        await stage("baseline-identity-finalization", async () => {
          const sizes = summaries.aggregate([{ $project: { size: { $bsonSize: "$$ROOT" } } }], options());
          try {
            for await (const { size } of sizes) budget.serialized(size * 4 + 65536);
          } finally {
            await sizes.close();
          }
          if (manifest.dataset !== "raw") return;
          // Match the legacy all-fifteen-present filter and map operation; do
          // not hash a previously finalized summary fixture a second time.
          const filter = Object.fromEntries(CATEGORIES.map(({ field }) => [field, { $exists: true, $ne: null }]));
          const cursor = summaries.find(filter, options());
          try {
            for await (const document of cursor) {
              const fields = Object.fromEntries(
                CATEGORIES.map(({ field }) => [
                  field,
                  document[field].map((value) => finalizeCid(value, comparisonContext.identitySecret)),
                ])
              );
              await summaries.updateOne({ _id: document._id }, { $set: fields });
            }
          } finally {
            await cursor.close();
          }
        });
        await stage("daily-facts-and-original-members", async () => {
          const cursor = summaries.find({}, options({ ...BSON_OPTIONS }));
          let rowNo = 0;
          try {
            for await (const summary of cursor) {
              const rowId = String(rowNo++);
              const facts = { ...summary };
              delete facts._id;
              const members = {};
              for (const { id, field } of CATEGORIES) {
                members[id] = {
                  chunks: 0,
                  cardinality: 0,
                  directorySha256: createHash("sha256").digest("hex"),
                  operandState: !Object.hasOwn(summary, field)
                    ? "missing"
                    : summary[field] === null
                      ? "null"
                      : Array.isArray(summary[field])
                        ? "array"
                        : "scalar",
                };
                delete facts[field];
              }
              const document = { ...facts, generationId, rowId, members, present: true };
              budget.serialized(BSON.serialize(document).length * 4 + 65536);
              await daily.insertOne(document);
              await summaries.updateOne({ _id: summary._id }, { $set: { modelRowId: rowId } });
            }
          } finally {
            await cursor.close();
          }
          for (const category of CATEGORIES) {
            const cursor = summaries.aggregate(
              [
                {
                  $project: {
                    _id: 0,
                    rowId: "$modelRowId",
                    value:
                      CATEGORIES.indexOf(category) < 6 ? { $setUnion: [`$${category.field}`] } : `$${category.field}`,
                  },
                },
                { $unwind: "$value" },
              ],
              options({ ...BSON_OPTIONS })
            );
            try {
              for await (const member of cursor)
                await values.insertOne({
                  generationId,
                  kind: "patient",
                  rowId: member.rowId,
                  category: category.id,
                  originalBsonValue: member.value,
                });
            } finally {
              await cursor.close();
            }
          }
        });
        await stage("expense-v1-daily-operands", async () => {
          // A one-row accumulator retains the baseline $group/$sum numeric
          // and ignored-operand behavior, including arrays and sparse fields.
          const cursor = summaries.aggregate(
            [
              {
                $group: {
                  _id: "$modelRowId",
                  ...Object.fromEntries(
                    CATEGORIES.slice(0, 6).flatMap(({ expense: field }, index) => [
                      [field, { $sum: `$${field}` }],
                      [`kind${index}`, { $first: { $type: `$${field}` } }],
                    ])
                  ),
                },
              },
            ],
            options({ ...BSON_OPTIONS })
          );
          try {
            for await (const row of cursor) {
              budget.serialized(BSON.serialize(row).length * 4 + 65536);
              const operands = CATEGORIES.slice(0, 6).map(({ expense: field }, index) => {
                const kind = row[`kind${index}`];
                expenseTypes.set(kind, (expenseTypes.get(kind) ?? 0) + 1);
                const value = expense.fromOperand(row[field]);
                expenseReference[index] = expense.add(expenseReference[index], value);
                return value;
              });
              await daily.updateOne(
                { generationId, rowId: row._id },
                {
                  $set: {
                    expenseVersion: expense.VERSION,
                    expenses: operands,
                    expenseSha256: expense.checksum(row._id, operands),
                  },
                }
              );
            }
          } finally {
            await cursor.close();
          }
        });
        await stage("baseline-daily-card-facts", () =>
          buildDailyCard({ summaries, daily, values, generationId, options, budget })
        );
        let identityCount = 0,
          indexedLookups = 0,
          exactLookups = 0;
        await stage("mongo-equivalence-dictionary", async () => {
          await identity.createIndex({ generationId: 1, kind: 1, ordinal: 1 }, { unique: true });
          await identity.createIndex(
            { generationId: 1, kind: 1, originalBsonValue: 1 },
            { collation, name: `patients_identity_value_${indexSuffix}` }
          );
          // $group is the authority for BSON numeric, embedded-value and
          // collation equivalence. The normal field avoids _id restrictions.
          const cursor = values.aggregate(
            [
              { $group: { _id: { kind: "$kind", value: "$originalBsonValue" } } },
              { $project: { _id: 0, kind: "$_id.kind", originalBsonValue: "$_id.value" } },
            ],
            options({ ...BSON_OPTIONS })
          );
          let ordinal = 0n;
          try {
            for await (const value of cursor) {
              if (ordinal >= 2n ** 63n) throw new Error("Dictionary Int64 ordinal exhausted");
              budget.serialized(BSON.serialize(value).length * 8 + 65536);
              await identity.insertOne({
                generationId,
                kind: value.kind,
                ordinal: Long.fromBigInt(ordinal++),
                originalBsonValue: value.originalBsonValue,
              });
              identityCount += 1;
            }
          } finally {
            await cursor.close();
          }
          const members = values.find({}, options({ ...BSON_OPTIONS }));
          try {
            for await (const member of members) {
              budget.check();
              const scope = { generationId, kind: member.kind };
              const exact = await identity
                .find(
                  { ...scope, $expr: { $eq: ["$originalBsonValue", { $literal: member.originalBsonValue }] } },
                  options({ ...BSON_OPTIONS })
                )
                .limit(2)
                .toArray();
              if (exact.length !== 1) throw new Error("Ambiguous BSON dictionary class");
              const value = member.originalBsonValue;
              const ordinary =
                value === null ||
                ["string", "number", "boolean"].includes(typeof value) ||
                ["Int32", "Long", "Double", "Decimal128", "ObjectId"].includes(value?._bsontype) ||
                value instanceof Date;
              let selected = exact[0];
              if (ordinary) {
                const indexed = await identity
                  .find({ ...scope, originalBsonValue: value }, options({ ...BSON_OPTIONS }))
                  .limit(2)
                  .toArray();
                if (indexed.length === 1 && indexed[0].ordinal.equals(exact[0].ordinal)) {
                  selected = indexed[0];
                  indexedLookups += 1;
                }
                // An ordinary scalar can also match an array's multikey index
                // entry. Its exact expression class remains the authority.
                else exactLookups += 1;
              } else exactLookups += 1;
              await edges.insertOne({
                generationId,
                setId: member.rowId,
                category: member.category,
                ...ordinalParts(selected.ordinal),
              });
            }
          } finally {
            await members.close();
          }
        });
        await stage("portable-daily-bitmaps", async () => {
          await edges.createIndex({ setId: 1, category: 1, block: 1, offset: 1 });
          await writeChunks({ edges, chunks, directory, daily, generationId, budget });
          await daily.createIndex({ generationId: 1, rowId: 1 }, { unique: true });
          await daily.createIndex(
            { generationId: 1, date: 1 },
            { collation, name: `patients_daily_date_${indexSuffix}` }
          );
          for (const field of ["area", "province", "district", "hcode"])
            await daily.createIndex(
              { generationId: 1, [field]: 1, date: 1 },
              { collation, name: `patients_daily_${field}_${indexSuffix}` }
            );
          await chunks.createIndex(
            { generationId: 1, setId: 1, category: 1, block: 1, chunkNo: 1 },
            { unique: true, collation, name: `patients_chunks_${indexSuffix}` }
          );
          await directory.createIndex(
            { generationId: 1, setId: 1, category: 1, block: 1, chunkNo: 1 },
            { unique: true, collation, name: `patients_directory_${indexSuffix}` }
          );
        });
        let storedAtoms;
        await stage("stored-month-atoms", async () => {
          storedAtoms = await buildStoredMonths({
            db,
            summaries,
            edges,
            generationId,
            prefix,
            budget,
            collation,
            indexSuffix,
            measureStorage,
          });
        });
        let preparedInventory;
        await stage("prepared-stored-month-scopes", async () => {
          preparedInventory = await buildPreparedScopes({
            db,
            daily,
            edges,
            generationId,
            prefix,
            budget,
            collation,
            indexSuffix,
            measureStorage,
          });
        });
        const rowCount = await daily.countDocuments({ generationId }, options());
        const chunkCount = await chunks.countDocuments({ generationId }, options());
        const indexes = [];
        for (const name of Object.values(COLLECTIONS)) {
          for await (const index of db.collection(name).listIndexes())
            indexes.push({
              collection: name,
              name: index.name,
              keys: index.key,
              unique: index.unique ?? false,
              ...(index.collation ? { collation: index.collation } : {}),
              ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}),
            });
        }
        const component = (complete = false) => ({ generationId, complete });
        const report = {
          generationId,
          complete: false,
          state: "candidate-partial",
          versions: VERSIONS,
          source: { ...manifest, rawComplete: manifest.dataset === "raw" },
          bindings: CATEGORIES.map(({ id, field }) => ({ id, field })),
          components: {
            patientsBar: component(true),
            daily: component(true),
            dictionary: component(true),
            patientDictionary: component(true),
            hospitalDictionary: component(true),
            monthlyStored: component(true),
            monthlyDateUtc: component(),
            preparedScopes: component(),
            preparedStored: component(true),
            card: component(true),
            expenseBar: component(true),
            snapshots: component(),
            control: component(),
          },
          inventory: {
            generationId,
            rows: rowCount,
            storedAtoms,
            ...preparedInventory,
            identities: identityCount,
            chunks: chunkCount,
            directories: chunkCount,
            indexedLookups,
            exactLookups,
            typeInventory,
            expense: { policy: expense.VERSION, runtime: process.version, bsonKinds: Object.fromEntries(expenseTypes) },
            indexes,
            stages,
          },
          resources: {
            ...budget.metrics,
            declared: declaredBudget,
            productionHeadroom: "unverified",
            databaseMemory: "unverified",
          },
          build: {
            runtime: process.version,
            platform: process.platform,
            arch: process.arch,
            driver: require("mongodb/package.json").version,
            codec: require("roaring/package.json").version,
            clock: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        };
        budget.serialized(BSON.serialize(report).length * 4 + 65536);
        await generations.replaceOne({ _id: generationId }, { _id: generationId, ...report, collation });
        await stage("patients-bar-differential-validation", async () => {
          const selection = { date: { $gte: new Date(manifest.history.start), $lte: new Date(manifest.history.end) } };
          const expectedCounts = [];
          for (const category of CATEGORIES.slice(0, 6)) {
            const result = await summaries
              .aggregate(
                [
                  { $match: selection },
                  { $project: { value: { $setUnion: [`$${category.field}`] } } },
                  { $unwind: "$value" },
                  { $group: { _id: "$value" } },
                  { $count: "count" },
                ],
                options()
              )
              .toArray();
            expectedCounts.push(result[0]?.count ?? 0);
          }
          const scalarReference = await summaries
            .aggregate(
              [
                { $match: selection },
                {
                  $group: {
                    _id: null,
                    ...Object.fromEntries(
                      CATEGORIES.slice(0, 6).map(({ service }) => [service, { $sum: `$${service}` }])
                    ),
                  },
                },
              ],
              options()
            )
            .toArray();
          const reader = require("./reader").createReader({ db, generationId, validationOnly: true });
          const facts = await reader.read(
            {
              route: "patients-bar/build-validation",
              backendMode: "candidate-validation",
              clock: new Date(manifest.sourceCutAt),
              timeZone: "UTC",
              timeoutMS: Math.min(60000, budget.check()),
            },
            ({ rangeFacts }) => rangeFacts(selection)
          );
          for (const [index, { service }] of CATEGORIES.slice(0, 6).entries()) {
            if (
              facts.counts[index] !== expectedCounts[index] ||
              !BSON.serialize({ value: facts.services[index] }).equals(
                BSON.serialize({ value: scalarReference[0]?.[service] ?? 0 })
              )
            )
              throw new Error("Patients Bar differential validation failed");
          }
          report.validation = {
            patientsBar: { equal: true, scope: "full-supported-history", categories: 6, counts: expectedCounts },
          };
          for (const [index, value] of expenseReference.entries()) {
            if (
              value.coefficient !== facts.expenseTotals[index].coefficient ||
              value.scale !== facts.expenseTotals[index].scale
            )
              throw new Error("Exact expense range validation failed");
            expense.roundedNumber(value);
            if (facts.counts[index] > 0) expense.roundedNumber(value, facts.counts[index]);
          }
          report.validation.expenseBar = {
            equal: true,
            scope: "full-supported-history",
            policy: expense.VERSION,
            totals: expenseReference,
          };
          report.validation.card = await validateDailyCard({ summaries, selection, facts, options });
        });
        await stage("stored-month-differential-validation", async () => {
          report.validation.monthlyStored = await validateStoredMonths({
            db,
            summaries,
            generationId,
            budget,
            collation,
            clock: new Date(manifest.sourceCutAt),
          });
        });
        await stage("prepared-stored-month-differential-validation", async () => {
          report.validation.preparedStored = await validatePreparedScopes({
            db,
            summaries,
            generationId,
            budget,
            collation,
            clock: new Date(manifest.sourceCutAt),
          });
        });
        for (const collection of [raw, summaries, values, edges]) await collection.drop();
        await measureStorage();
        report.resources = { ...report.resources, ...budget.metrics };
        budget.serialized(BSON.serialize(report).length * 4 + 65536);
        report.resources = { ...report.resources, ...budget.metrics };
        await generations.replaceOne({ _id: generationId }, { _id: generationId, ...report, collation });
        return report;
      } catch (error) {
        await generations.updateOne(
          { _id: generationId },
          { $set: { state: "failed", complete: false, failedStage: stages.length, resources: budget.metrics } }
        );
        throw error;
      } finally {
        if (source) await source.close();
        for (const collection of [raw, summaries, values, edges]) await collection.drop();
        busy = false;
      }
    },
    async publish() {
      throw new Error("Cannot publish incomplete six-endpoint candidate");
    },
  });
}

module.exports = { createBuilder };
