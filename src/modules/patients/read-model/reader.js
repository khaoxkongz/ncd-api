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
const { createControl, HEARTBEAT_MS, buildContext } = require("./control");
const { complete } = require("./generation");
const { scope: lifetime, trackedDb, rawDb: unwrapDb, WORKER: worker, within } = require("./lifetime");
const { createCapacity, HTTP_CAPACITY } = require("./capacity");

function compatible(versions) {
  return (
    versions &&
    Object.keys(versions).length === Object.keys(VERSIONS).length &&
    Object.entries(VERSIONS).every(([key, value]) => versions[key] === value)
  );
}

function createReader({ db, generationId: explicitGenerationId, validationOnly = false, capacity }) {
  if (!db) throw new Error("An explicit Mongo adapter is required");
  const rawDb = unwrapDb(db);
  const capacityContext = buildContext.getStore()?.capacity ?? createCapacity({ db: rawDb, config: capacity });
  db = trackedDb(rawDb);
  const control = createControl({ db: rawDb, worker });
  const coordinationBudget = () => createBudget({ maxTimeMS: 60000 }, { request: true });
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
      let pin;
      let heartbeat;
      let generationId = explicitGenerationId;
      if (await control.exists(requestBudget)) {
        const claim = explicitGenerationId ? buildContext.getStore()?.claim : undefined;
        if (explicitGenerationId && (!claim || claim.generationId !== explicitGenerationId))
          throw new Error("Managed generation cannot bypass active selection");
        pin = await control.pin(worker, requestBudget, claim);
        generationId = pin.generationId;
        heartbeat = setInterval(() => {
          void control.renew(pin, coordinationBudget()).catch(() => {});
        }, HEARTBEAT_MS);
        heartbeat.unref();
      } else if (!explicitGenerationId) throw new Error("Read-model control unavailable");
      const requestScope = lifetime({ db: rawDb, budget: requestBudget, pin });
      let resourceOwner;
      try {
        resourceOwner = await capacityContext.begin(requestBudget, "api", { pin, worker, generationId });
        requestContext[HTTP_CAPACITY]?.bind(resourceOwner);
      } catch (error) {
        clearInterval(heartbeat);
        let proof = { safe: error.controlOutcome !== "unknown", proof: "capacity-admission-before-model-dispatch" };
        requestBudget.settlement = coordinationBudget();
        try {
          proof = (await requestBudget.capacity?.finish(proof)) ?? proof;
        } catch {
          proof = { safe: false, proof: "capacity-admission-settlement-unverified" };
        }
        if (pin) {
          if (!proof.safe) await control.suspect(pin, coordinationBudget());
          else await control.release(pin, coordinationBudget());
        }
        throw error;
      }
      let accepting = true;
      const execution = requestScope.task(async () => {
        const generations = db.collection(COLLECTIONS.generations),
          daily = db.collection(COLLECTIONS.daily),
          chunks = db.collection(COLLECTIONS.chunks),
          directory = db.collection(COLLECTIONS.directory);
        const generation = await generations.findOne({ _id: generationId }, requestBudget.options());
        if (generation) requestBudget.serialized(BSON.serialize(generation).length * 4 + 65536);
        if (
          !generation ||
          generation.generationId !== generationId ||
          !["candidate-partial", "ready"].includes(generation.state) ||
          !generation.components.patientsBar.complete ||
          !compatible(generation.versions)
        )
          throw new Error("Incomplete or incompatible Patients Bar component");
        if (pin?.descriptorSeal) {
          complete(generation);
          if (pin.descriptorSeal !== generation.seal) throw new Error("Pinned generation descriptor changed");
        } else if (!pin && generation.comparisonOnly !== true)
          throw new Error("Unmanaged candidate is not an explicit comparison fixture");
        if (
          requestContext.route.startsWith("expense-bar/") &&
          (!generation.components.expenseBar?.complete ||
            generation.components.expenseBar.generationId !== generationId)
        )
          throw new Error("Incomplete or incompatible expense Bar component");
        if (
          requestContext.route.startsWith("card/") &&
          ["card", "hospitalDictionary"].some(
            (name) =>
              !generation.components[name]?.complete || generation.components[name].generationId !== generationId
          )
        )
          throw new Error("Incomplete or incompatible Card component");
        const collation = generation.collation;
        capacityContext.source(generation.source);
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
          const bitmaps = counts.map(() => budget.bitmap(() => new native.RoaringBitmap32()));
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
          let entry = inFlight.find((item) => !item.cancelled && item.key.equals(key));
          if (!entry) {
            if (inFlight.length >= 64) throw new Error("Range work coordination limit exceeded");
            entry = {
              key,
              consumers: 0,
              resourceParents: new Set(),
              workPin: pin ? control.fork(pin, requestBudget) : Promise.resolve(undefined),
            };
            entry.promise = shared(entry, (budget) => calculateRange(selection, budget));
            void entry.promise.catch(() => {});
            inFlight.push(entry);
          }
          const result = await consume(entry);
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
          let entry = inFlight.find((item) => !item.cancelled && item.key.equals(key));
          if (!entry) {
            if (inFlight.length >= 64) throw new Error("Monthly work coordination limit exceeded");
            entry = {
              key,
              consumers: 0,
              resourceParents: new Set(),
              workPin: pin ? control.fork(pin, requestBudget) : Promise.resolve(undefined),
            };
            entry.promise = shared(entry, (budget) => calculateMonths({ db, generation, scope, periods, budget }));
            void entry.promise.catch(() => {});
            inFlight.push(entry);
          }
          const result = await consume(entry);
          requestBudget.check();
          return Object.freeze({
            ...result,
            source: sourceState(generationProvenance(generation), requestContext.clock),
          });
        }
        const snapshot = (endpoint) =>
          readSnapshot({ db, generation, endpoint, clock: requestContext.clock, budget: requestBudget });
        function fact(fn) {
          if (!accepting) return Promise.reject(new Error("Read callback has ended"));
          return requestScope.task(fn);
        }
        function operands(result) {
          if (!result.expenseOperands) return result;
          return Object.freeze({
            ...result,
            expenseOperands: {
              [Symbol.asyncIterator]() {
                if (!accepting) throw new Error("Read callback has ended");
                const iterator = result.expenseOperands[Symbol.asyncIterator]();
                return {
                  next: () => fact(() => iterator.next()),
                  return: () =>
                    accepting
                      ? requestScope.task(() => iterator.return?.() ?? { done: true })
                      : Promise.resolve({ done: true }),
                };
              },
            },
          });
        }
        async function shared(entry, calculate) {
          let workPin, heartbeat;
          let finished;
          entry.finish = () => {
            if (!entry.settled || entry.consumers) return;
            return (finished ??= (async () => {
              try {
                entry.resultRelease?.();
                if (entry.resources) {
                  budget.settlement = coordinationBudget();
                  entry.proof = await entry.resources.finish(entry.proof);
                }
                if (workPin) {
                  if (entry.proof.safe) await control.release(workPin, coordinationBudget());
                  else await control.suspect(workPin, coordinationBudget());
                }
              } finally {
                clearInterval(heartbeat);
              }
            })());
          };
          const budget = createBudget({ maxTimeMS: requestBudget.check() }, { request: true });
          let ready, failed;
          entry.resourceReady = new Promise((resolve, reject) => {
            ready = resolve;
            failed = reject;
          });
          void entry.resourceReady.catch(() => {});
          try {
            workPin = await entry.workPin;
            entry.resources = await capacityContext.begin(budget, "api", {
              pin: workPin,
              worker,
              generationId,
              dependents: entry.resourceParents,
            });
            entry.scope = lifetime({ db: rawDb, budget, pin: workPin });
            ready(entry.resources);
            if (entry.cancelled) entry.scope.stop();
            if (workPin) {
              heartbeat = setInterval(() => {
                void control.renew(workPin, coordinationBudget()).catch(() => {});
              }, HEARTBEAT_MS);
              heartbeat.unref();
            }
            const result = await entry.scope.task(() => calculate(budget));
            entry.resultRelease = entry.resources.hold(result, "decoded");
            return result;
          } catch (error) {
            entry.resources ??= budget.capacity;
            failed(error);
            throw error;
          } finally {
            entry.proof = entry.scope ? await entry.scope.drain() : { safe: true };
            entry.settled = true;
            const index = inFlight.indexOf(entry);
            if (index >= 0) inFlight.splice(index, 1);
            // A fast calculation can finish while another registered consumer
            // is still linking its reader pin. Keep the shared pin until every
            // consumer has completed that guarded handoff and consumption.
            await entry.finish();
          }
        }
        async function consume(entry) {
          entry.consumers += 1;
          entry.resourceParents.add(resourceOwner);
          try {
            const workPin = await entry.workPin;
            if (pin && workPin) await control.link(pin, workPin, requestBudget);
            const sharedOwner = await within(entry.resourceReady, requestBudget, requestContext.signal);
            await resourceOwner.link(sharedOwner);
            const value = await within(entry.promise, requestBudget, requestContext.signal);
            requestBudget.hold(value, "decoded");
            return value;
          } finally {
            entry.resourceParents.delete(resourceOwner);
            entry.consumers -= 1;
            if (entry.consumers === 0) {
              entry.cancelled = true;
              entry.scope?.stop();
              await entry.finish();
            }
          }
        }
        let result;
        try {
          result = await callback(
            Object.freeze({
              rangeFacts: (selection) => fact(async () => operands(await rangeFacts(selection))),
              monthFacts: (scope, periods) => fact(() => monthFacts(scope, periods)),
              snapshot: (endpoint) => fact(() => snapshot(endpoint)),
            })
          );
        } finally {
          accepting = false;
        }
        requestBudget.check();
        return result;
      });
      const settled = execution.then(
        async (result) => {
          await finalize();
          return result;
        },
        async (error) => {
          await finalize();
          throw error;
        }
      );
      async function finalize() {
        accepting = false;
        const proof = resourceOwner.settlementProof(await requestScope.drain());
        requestBudget.settlement = coordinationBudget();
        if (requestContext[HTTP_CAPACITY]) requestContext[HTTP_CAPACITY].settle(proof);
        else await resourceOwner.finish(proof);
        clearInterval(heartbeat);
        if (pin) {
          if (proof.safe) await control.release(pin, coordinationBudget());
          else await control.suspect(pin, coordinationBudget());
        }
      }
      try {
        return await within(settled, requestBudget, requestContext.signal);
      } catch (error) {
        requestScope.stop();
        void settled.catch(() => {});
        throw error;
      }
    },
  });
}

module.exports = { createReader };
