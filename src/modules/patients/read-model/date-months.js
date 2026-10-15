const { createHash, randomUUID } = require("node:crypto");
const { BSON, Binary } = require("mongodb");
const { CATEGORIES, COLLECTIONS, BSON_OPTIONS } = require("./schema");
const { codec, writeChunks, decodeChunk, directoryToken } = require("./bitmap");
const card = require("./daily-card");
const expense = require("./expense");
const { buildScopeCatalog, lookupPreparedScope } = require("./prepared-scopes");

const VERSION = "date-utc-months-v1";
const GEOGRAPHY = ["hcode", "area", "province", "district"];
const SETS = [...CATEGORIES.slice(0, 6).map(({ id }) => id), ...card.SETS];

function monthBounds(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  // setUTCFullYear avoids Date.UTC's special handling of years zero to 99.
  const start = new Date(0);
  start.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (!Number.isFinite(next.getTime())) return null;
  return { monthStart: start, monthEnd: new Date(next.getTime() - 1) };
}

function checksum(document) {
  const facts = { ...document };
  delete facts._id;
  delete facts.sha256;
  return createHash("sha256").update(BSON.serialize(facts)).digest("hex");
}

function emptyMembers() {
  return Object.fromEntries(
    SETS.map((id) => [id, { chunks: 0, cardinality: 0, directorySha256: createHash("sha256").digest("hex") }])
  );
}

function serviceChecksum(row) {
  return createHash("sha256")
    .update(
      BSON.serialize({
        version: "baseline-services-v1",
        rowId: row.rowId,
        operands: Object.fromEntries(
          CATEGORIES.slice(0, 6)
            .filter(({ service }) => Object.hasOwn(row, service))
            .map(({ service }) => [service, row[service]])
        ),
      })
    )
    .digest("hex");
}

function validateServiceFacts(row) {
  if (
    row.dailyServiceSha256 !== serviceChecksum(row) ||
    !row.card ||
    row.card.version !== card.VERSION ||
    row.card.sha256 !== card.checksum(row.rowId, row.card)
  )
    throw new Error("Missing or changed original range service facts");
}

// Separate UTC-date atoms: stored year/month never enter this family. A source
// date with array/query semantics is deliberately retained as exact daily data.
async function buildDateMonths({
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
  const atoms = db.collection(COLLECTIONS.dateMonths);
  const mappings = db.collection(`${prefix}_date_rows`);
  const monthEdges = db.collection(`${prefix}_date_edges`);
  const options = (extra = {}) => budget.options({ collation, ...extra });
  await atoms.createIndex({ generationId: 1, monthStart: 1, partitionId: 1 }, { unique: true });
  await atoms.createIndex({ generationId: 1, rowId: 1 }, { unique: true });
  let dailyOnlyRows = 0;
  try {
    const cursor = daily.find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const row of cursor) {
        await daily.updateOne(
          { generationId, rowId: row.rowId },
          { $set: { dailyServiceSha256: serviceChecksum(row) } }
        );
        const bounds = monthBounds(row.date);
        if (!bounds) {
          dailyOnlyRows += 1;
          await daily.updateOne({ generationId, rowId: row.rowId }, { $set: { dateMonthEligible: false } });
          continue;
        }
        const geography = Object.fromEntries(
          GEOGRAPHY.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])
        );
        const partitionId = new Binary(BSON.serialize(geography));
        const metadata = {
          generationId,
          rowId: `date-${randomUUID()}`,
          version: VERSION,
          periodKind: "date-utc",
          ...bounds,
          partitionId,
          ...geography,
          expenses: Array(6).fill(expense.ZERO),
          members: emptyMembers(),
        };
        budget.serialized(BSON.serialize({ metadata, row }).length * 4 + 65536);
        const atom = await atoms.findOneAndUpdate(
          { generationId, monthStart: bounds.monthStart, partitionId },
          { $setOnInsert: metadata, $inc: { matchedRows: 1 } },
          options({ upsert: true, returnDocument: "after", ...BSON_OPTIONS })
        );
        if (
          row.expenseVersion !== expense.VERSION ||
          row.expenseSha256 !==
            expense.checksum(
              row.rowId,
              row.expenses.map((value) => ({ ...value, scale: Number(value.scale) }))
            )
        )
          throw new Error("Invalid daily expenses during date-month build");
        const expenses = atom.expenses.map((value, index) =>
          expense.add(
            { ...value, scale: Number(value.scale) },
            { ...row.expenses[index], scale: Number(row.expenses[index].scale) }
          )
        );
        await atoms.updateOne({ generationId, rowId: atom.rowId }, { $set: { expenses } });
        await daily.updateOne({ generationId, rowId: row.rowId }, { $set: { dateMonthEligible: true, ...bounds } });
        await mappings.insertOne({ rowId: row.rowId, setId: atom.rowId });
      }
    } finally {
      await cursor.close();
    }
    await mappings.createIndex({ rowId: 1 }, { unique: true });
    const services = daily.aggregate(
      [
        { $match: { generationId, dateMonthEligible: true } },
        { $lookup: { from: mappings.collectionName, localField: "rowId", foreignField: "rowId", as: "atom" } },
        { $unwind: "$atom" },
        {
          $group: {
            _id: "$atom.setId",
            cardService: { $sum: "$card.service" },
            cardServiceErrors: { $sum: { $cond: [{ $eq: ["$card.serviceState", "error"] }, 1, 0] } },
            ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ service }) => [service, { $sum: `$${service}` }])),
          },
        },
      ],
      options({ ...BSON_OPTIONS, allowDiskUse: false })
    );
    try {
      for await (const values of services) {
        budget.serialized(BSON.serialize(values).length * 4 + 65536);
        await atoms.updateOne(
          { generationId, rowId: values._id },
          {
            $set: {
              services: CATEGORIES.slice(0, 6).map(({ service }) => values[service]),
              cardService: values.cardService,
              cardServiceErrors: values.cardServiceErrors,
            },
          }
        );
      }
    } finally {
      await services.close();
    }
    const cursorEdges = edges.aggregate(
      [
        { $match: { generationId, category: { $in: SETS } } },
        { $lookup: { from: mappings.collectionName, localField: "setId", foreignField: "rowId", as: "atom" } },
        { $unwind: "$atom" },
        { $project: { _id: 0, generationId: 1, setId: "$atom.setId", category: 1, block: 1, offset: 1 } },
      ],
      options({ ...BSON_OPTIONS })
    );
    try {
      for await (const edge of cursorEdges) {
        budget.serialized(BSON.serialize(edge).length * 4 + 65536);
        await monthEdges.insertOne(edge);
      }
    } finally {
      await cursorEdges.close();
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
    const seal = atoms.find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const atom of seal) await atoms.updateOne({ _id: atom._id }, { $set: { sha256: checksum(atom) } });
    } finally {
      await seal.close();
    }
    await atoms.createIndex(
      { generationId: 1, monthStart: 1, monthEnd: 1 },
      { collation, name: `patients_date_month_${indexSuffix}` }
    );
    for (const field of GEOGRAPHY)
      await atoms.createIndex(
        { generationId: 1, [field]: 1, monthStart: 1, monthEnd: 1 },
        { collation, name: `patients_date_month_${field}_${indexSuffix}` }
      );
    await daily.createIndex(
      { generationId: 1, dateMonthEligible: 1, monthStart: 1, monthEnd: 1 },
      { collation, name: `patients_daily_date_month_${indexSuffix}` }
    );
    await measureStorage();
  } finally {
    await mappings.drop();
    await monthEdges.drop();
  }
  const prepared = await buildPreparedDateMonths({
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
  return {
    version: VERSION,
    atoms: await atoms.countDocuments({ generationId }, options()),
    dailyOnlyRows,
    ...prepared,
  };
}

async function buildPreparedDateMonths({
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
  const scopes = await buildScopeCatalog({ db, daily, generationId, budget, collation, indexSuffix });
  const months = db.collection(COLLECTIONS.dateMonthScopes),
    mappings = db.collection(`${prefix}_date_scope_rows`),
    scopeEdges = db.collection(`${prefix}_date_scope_edges`);
  const options = (extra = {}) => budget.options({ collation, ...extra });
  await months.createIndex({ generationId: 1, scopeId: 1, monthStart: 1 }, { unique: true });
  await months.createIndex({ generationId: 1, rowId: 1 }, { unique: true });
  try {
    const catalog = db.collection(COLLECTIONS.scopes).find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const scope of catalog) {
        const predicate = scope.scopeKind === "national" ? {} : { [scope.scopeKind]: { $eq: scope.value } };
        const rows = daily.find(
          { generationId, dateMonthEligible: true, ...predicate },
          options({ ...BSON_OPTIONS, projection: { rowId: 1, monthStart: 1, monthEnd: 1, expenses: 1 } })
        );
        try {
          for await (const row of rows) {
            const metadata = {
              generationId,
              rowId: `date-scope-${randomUUID()}`,
              version: VERSION,
              periodKind: "date-utc",
              scopeId: scope.scopeId,
              scopeSha256: scope.sha256,
              monthStart: row.monthStart,
              monthEnd: row.monthEnd,
              expenses: Array(6).fill(expense.ZERO),
              members: emptyMembers(),
            };
            const atom = await months.findOneAndUpdate(
              { generationId, scopeId: scope.scopeId, monthStart: row.monthStart },
              { $setOnInsert: metadata, $inc: { matchedRows: 1 } },
              options({ upsert: true, returnDocument: "after", ...BSON_OPTIONS })
            );
            budget.serialized(BSON.serialize({ row, atom }).length * 4 + 65536);
            const expenses = atom.expenses.map((value, index) =>
              expense.add(
                { ...value, scale: Number(value.scale) },
                { ...row.expenses[index], scale: Number(row.expenses[index].scale) }
              )
            );
            await months.updateOne({ _id: atom._id }, { $set: { expenses } });
            await mappings.insertOne({ rowId: row.rowId, setId: atom.rowId });
          }
        } finally {
          await rows.close();
        }
      }
    } finally {
      await catalog.close();
    }
    await mappings.createIndex({ rowId: 1 });
    const scalars = daily.aggregate(
      [
        { $match: { generationId, dateMonthEligible: true } },
        { $lookup: { from: mappings.collectionName, localField: "rowId", foreignField: "rowId", as: "atom" } },
        { $unwind: "$atom" },
        {
          $group: {
            _id: "$atom.setId",
            cardService: { $sum: "$card.service" },
            cardServiceErrors: { $sum: { $cond: [{ $eq: ["$card.serviceState", "error"] }, 1, 0] } },
            ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ service }) => [service, { $sum: `$${service}` }])),
          },
        },
      ],
      options({ ...BSON_OPTIONS, allowDiskUse: false })
    );
    try {
      for await (const values of scalars) {
        budget.serialized(BSON.serialize(values).length * 4 + 65536);
        await months.updateOne(
          { generationId, rowId: values._id },
          {
            $set: {
              services: CATEGORIES.slice(0, 6).map(({ service }) => values[service]),
              cardService: values.cardService,
              cardServiceErrors: values.cardServiceErrors,
            },
          }
        );
      }
    } finally {
      await scalars.close();
    }
    const members = edges.aggregate(
      [
        { $match: { generationId, category: { $in: SETS } } },
        { $lookup: { from: mappings.collectionName, localField: "setId", foreignField: "rowId", as: "atom" } },
        { $unwind: "$atom" },
        { $project: { _id: 0, generationId: 1, setId: "$atom.setId", category: 1, block: 1, offset: 1 } },
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
    const seal = months.find({ generationId }, options({ ...BSON_OPTIONS }));
    try {
      for await (const atom of seal) {
        budget.serialized(BSON.serialize(atom).length * 4 + 65536);
        await months.updateOne({ _id: atom._id }, { $set: { sha256: checksum(atom) } });
      }
    } finally {
      await seal.close();
    }
    await months.createIndex(
      { generationId: 1, scopeId: 1, monthStart: 1, monthEnd: 1 },
      { collation, name: `patients_date_scope_period_${indexSuffix}` }
    );
    await measureStorage();
  } finally {
    await mappings.drop();
    await scopeEdges.drop();
  }
  return { scopes, scopeMonths: await months.countDocuments({ generationId }, options()) };
}

function planRange(selection) {
  if (!selection || Object.keys(selection).some((key) => key !== "date" && !GEOGRAPHY.includes(key))) return null;
  const date = selection.date;
  if (!date || Object.keys(date).length !== 2 || !(date.$gte instanceof Date) || !(date.$lte instanceof Date))
    return null;
  if (!Number.isFinite(date.$gte.getTime()) || !Number.isFinite(date.$lte.getTime())) return null;
  const bounds = monthBounds(date.$gte);
  if (!bounds) return null;
  const first = new Date(bounds.monthStart);
  if (first < date.$gte) first.setUTCMonth(first.getUTCMonth() + 1);
  const last = monthBounds(first);
  if (!last || last.monthEnd > date.$lte) return null;
  const full = { monthStart: { $gte: first }, monthEnd: { $lte: date.$lte } };
  const scope = Object.fromEntries(
    GEOGRAPHY.filter((field) => Object.hasOwn(selection, field)).map((field) => [field, selection[field]])
  );
  return { full, scope };
}

function chunkSelection(match) {
  return [
    { $match: match },
    {
      $lookup: {
        from: COLLECTIONS.chunks,
        localField: "rowId",
        foreignField: "setId",
        pipeline: [{ $match: { generationId: match.generationId, category: { $in: SETS } } }],
        as: "parts",
      },
    },
    { $unwind: "$parts" },
    { $replaceWith: "$parts" },
  ];
}

async function calculateDateRange({ db, generation, selection, budget }) {
  const plan = planRange(selection);
  if (!plan) return null;
  const generationId = generation.generationId;
  if (
    !generation.components.monthlyDateUtc?.complete ||
    generation.components.monthlyDateUtc.generationId !== generationId
  )
    throw new Error("Incomplete UTC-date month component");
  const options = (extra = {}) => budget.options({ collation: generation.collation, ...extra });
  const atoms = db.collection(COLLECTIONS.dateMonths),
    daily = db.collection(COLLECTIONS.daily),
    chunks = db.collection(COLLECTIONS.chunks),
    directory = db.collection(COLLECTIONS.directory);
  if (
    (await atoms.countDocuments({ generationId }, options())) !== generation.inventory.dateUtc.atoms ||
    (await daily.countDocuments({ generationId }, options())) !== generation.inventory.rows ||
    (await chunks.countDocuments({ generationId }, options())) !== generation.inventory.chunks ||
    (await directory.countDocuments({ generationId }, options())) !== generation.inventory.directories
  )
    throw new Error("Date-month generation inventory changed");
  if (
    !generation.components.preparedDateUtc?.complete ||
    generation.components.preparedDateUtc.generationId !== generationId ||
    (await db.collection(COLLECTIONS.scopes).countDocuments({ generationId }, options())) !==
      generation.inventory.dateUtc.scopes ||
    (await db.collection(COLLECTIONS.dateMonthScopes).countDocuments({ generationId }, options())) !==
      generation.inventory.dateUtc.scopeMonths
  )
    throw new Error("Incomplete or changed prepared UTC-date inventory");
  const prepared = await lookupPreparedScope({
    db,
    generationId,
    scope: plan.scope,
    budget,
    collation: generation.collation,
  });
  const monthlyCollection = prepared ? db.collection(COLLECTIONS.dateMonthScopes) : atoms;
  const monthlyMatch = {
    ...(prepared ? { scopeId: prepared.scopeId } : plan.scope),
    ...plan.full,
    generationId,
    periodKind: "date-utc",
  };
  const dailyMatch = { ...selection, generationId, $nor: [{ dateMonthEligible: true, ...plan.full }] };
  const expectedChunks = SETS.map(() => 0),
    expectedMembers = SETS.map(() => 0),
    expenseTotals = Array(6).fill(expense.ZERO);
  let matchedRows = 0;
  for (const [collection, match, monthly] of [
    [monthlyCollection, monthlyMatch, true],
    [daily, dailyMatch, false],
  ]) {
    const cursor = collection.find(match, options({ ...BSON_OPTIONS }));
    try {
      for await (const row of cursor) {
        budget.serialized(BSON.serialize(row).length * 4 + 65536);
        if (monthly) {
          if (
            row.version !== VERSION ||
            row.sha256 !== checksum(row) ||
            (prepared && row.scopeSha256 !== prepared.sha256)
          )
            throw new Error("Missing or changed UTC-date month facts");
        } else if (
          !row.card ||
          row.card.version !== card.VERSION ||
          row.card.sha256 !== card.checksum(row.rowId, row.card)
        ) {
          throw new Error("Missing or changed daily Card facts");
        }
        row.expenses = row.expenses?.map((value) => ({ ...value, scale: Number(value.scale) }));
        if (
          !Array.isArray(row.expenses) ||
          row.expenses.length !== 6 ||
          (!monthly &&
            (row.expenseVersion !== expense.VERSION || row.expenseSha256 !== expense.checksum(row.rowId, row.expenses)))
        )
          throw new Error("Missing or changed range expense facts");
        for (let index = 0; index < 6; index += 1)
          expenseTotals[index] = expense.add(expenseTotals[index], row.expenses[index]);
        matchedRows += monthly ? Number(row.matchedRows) : 1;
        for (const [index, id] of SETS.entries()) {
          const member = row.members?.[id];
          if (
            !member ||
            !Number.isSafeInteger(Number(member.chunks)) ||
            Number(member.chunks) < 0 ||
            !Number.isSafeInteger(Number(member.cardinality)) ||
            Number(member.cardinality) < 0 ||
            (Number(member.chunks) === 0) !== (Number(member.cardinality) === 0) ||
            !/^[a-f0-9]{64}$/.test(member.directorySha256)
          )
            throw new Error("Missing UTC-date set inventory");
          expectedChunks[index] += Number(member.chunks);
          expectedMembers[index] += Number(member.cardinality);
        }
      }
    } finally {
      await cursor.close();
    }
  }
  // Mongo's baseline service accumulator is not associative for every BSON
  // numeric kind. Keep one original-row accumulator across the exact predicate;
  // monthly service facts are retained without substituting rounded/typed sums.
  const serviceCursor = daily.find(
    { ...selection, generationId },
    options({
      ...BSON_OPTIONS,
      projection: {
        rowId: 1,
        card: 1,
        dailyServiceSha256: 1,
        ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ service }) => [service, 1])),
      },
    })
  );
  try {
    for await (const row of serviceCursor) {
      budget.serialized(BSON.serialize(row).length * 4 + 65536);
      validateServiceFacts(row);
    }
  } finally {
    await serviceCursor.close();
  }
  const [scalars] = await daily
    .aggregate(
      [
        { $match: { ...selection, generationId } },
        {
          $group: {
            _id: null,
            matchedRows: { $sum: 1 },
            cardService: { $sum: "$card.service" },
            cardServiceErrors: { $sum: { $cond: [{ $eq: ["$card.serviceState", "error"] }, 1, 0] } },
            ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ service }) => [service, { $sum: `$${service}` }])),
          },
        },
      ],
      options()
    )
    .toArray();
  if (matchedRows !== (scalars?.matchedRows ?? 0)) throw new Error("Date-month row coverage changed");
  function selectedDirectory(match) {
    return [
      { $match: match },
      {
        $lookup: {
          from: COLLECTIONS.directory,
          localField: "rowId",
          foreignField: "setId",
          pipeline: [{ $match: { generationId, category: { $in: SETS } } }],
          as: "parts",
        },
      },
      { $unwind: "$parts" },
      { $replaceWith: { $mergeObjects: ["$parts", { eligible: { members: "$members" } }] } },
    ];
  }
  const directoryCursor = monthlyCollection.aggregate(
    [
      ...selectedDirectory(monthlyMatch),
      { $unionWith: { coll: COLLECTIONS.daily, pipeline: selectedDirectory(dailyMatch) } },
      { $sort: { setId: 1, category: 1, block: 1, chunkNo: 1 } },
    ],
    options({ promoteLongs: false, allowDiskUse: false })
  );
  let sealedSet;
  function finishDirectory() {
    if (!sealedSet) return;
    if (
      sealedSet.digest.digest("hex") !== sealedSet.inventory.directorySha256 ||
      sealedSet.chunks !== sealedSet.inventory.chunks ||
      sealedSet.members !== sealedSet.inventory.cardinality
    )
      throw new Error("Changed UTC-date set directory");
  }
  try {
    for await (const document of directoryCursor) {
      budget.serialized(BSON.serialize(document).length * 4 + 65536);
      if (!sealedSet || sealedSet.setId !== document.setId || sealedSet.category !== document.category) {
        finishDirectory();
        sealedSet = {
          setId: document.setId,
          category: document.category,
          inventory: document.eligible.members[document.category],
          chunks: 0,
          members: 0,
          digest: createHash("sha256"),
        };
      }
      sealedSet.digest.update(directoryToken(document));
      sealedSet.chunks += 1;
      sealedSet.members += document.popcount;
    }
    finishDirectory();
  } finally {
    await directoryCursor.close();
  }
  const cursor = monthlyCollection.aggregate(
    [
      ...chunkSelection(monthlyMatch),
      { $unionWith: { coll: COLLECTIONS.daily, pipeline: chunkSelection(dailyMatch) } },
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
    options({ promoteLongs: false, allowDiskUse: false })
  );
  const counts = SETS.map(() => 0),
    readChunks = SETS.map(() => 0),
    readMembers = SETS.map(() => 0);
  const native = codec(),
    bitmap = budget.bitmap(() => new native.RoaringBitmap32());
  let current;
  function finish() {
    if (!current) return;
    counts[current.index] += bitmap.size;
    if (!Number.isSafeInteger(counts[current.index])) throw new Error("Unsafe exact range cardinality");
    bitmap.clear();
  }
  try {
    for await (const document of cursor) {
      const index = SETS.indexOf(document.category);
      if (
        index < 0 ||
        document.directory.length !== 1 ||
        !directoryToken(document).equals(directoryToken(document.directory[0]))
      )
        throw new Error("Missing or changed UTC-date directory entry");
      if (current && (current.index !== index || !current.block.equals(document.block))) finish();
      current = { index, block: document.block };
      readChunks[index] += 1;
      readMembers[index] += document.popcount;
      delete document.directory;
      const contribution = decodeChunk(document, budget);
      try {
        bitmap.orInPlace(contribution);
      } finally {
        contribution.dispose();
      }
      budget.native(native.getRoaringUsedMemory());
    }
    finish();
    if (
      SETS.some(
        (_, index) => readChunks[index] !== expectedChunks[index] || readMembers[index] !== expectedMembers[index]
      )
    )
      throw new Error("Missing or extra selected UTC-date chunks");
  } finally {
    await cursor.close();
    bitmap.dispose();
  }
  return Object.freeze({
    counts: counts.slice(0, 6),
    cardPatientCount: counts[6],
    hospitalCount: counts[7],
    services: CATEGORIES.slice(0, 6).map(({ service }) => scalars?.[service] ?? 0),
    cardService: scalars?.cardService ?? 0,
    cardServiceError: (scalars?.cardServiceErrors ?? 0) > 0,
    expenseTotals: Object.freeze(expenseTotals),
    matchedRows,
    empty: matchedRows === 0,
    expenseOperands: {
      async *[Symbol.asyncIterator]() {
        const cursor = daily.find(
          { ...selection, generationId },
          options({
            ...BSON_OPTIONS,
            projection: { _id: 0, ...Object.fromEntries(CATEGORIES.slice(0, 6).map(({ expense }) => [expense, 1])) },
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

async function validateDateMonths({ db, generationId, budget, collation }) {
  const options = (extra = {}) => budget.options({ collation, ...extra });
  const native = codec();
  function stream(collection, match, daily = false) {
    const cursor = db.collection(collection).aggregate(
      [
        { $match: match },
        {
          $project: {
            rowId: 1,
            monthStart: daily ? { $dateTrunc: { date: "$date", unit: "month", timezone: "UTC" } } : "$monthStart",
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.chunks,
            localField: "rowId",
            foreignField: "setId",
            pipeline: [{ $match: { generationId, category: { $in: SETS } } }],
            as: "parts",
          },
        },
        { $unwind: "$parts" },
        { $project: { _id: 0, monthStart: 1, chunk: "$parts" } },
        { $sort: { "chunk.block": 1, monthStart: 1, "chunk.category": 1, "chunk.setId": 1, "chunk.chunkNo": 1 } },
      ],
      options({ promoteLongs: false, allowDiskUse: false })
    );
    let pending;
    return {
      close: () => cursor.close(),
      async next() {
        let document = pending ?? (await cursor.next());
        pending = undefined;
        if (!document) return;
        const keyFor = (row) =>
          BSON.serialize({ block: row.chunk.block, monthStart: row.monthStart, category: row.chunk.category });
        const key = keyFor(document),
          bitmap = budget.bitmap(() => new native.RoaringBitmap32());
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
  let scopes = 0,
    setBlocks = 0;
  const catalog = db.collection(COLLECTIONS.scopes).find({ generationId }, options({ ...BSON_OPTIONS }));
  try {
    for await (const scope of catalog) {
      const predicate = scope.scopeKind === "national" ? {} : { [scope.scopeKind]: { $eq: scope.value } };
      const sources = [
        stream(
          COLLECTIONS.daily,
          { generationId, ...predicate, dateMonthEligible: true, $expr: { $eq: [{ $type: "$date" }, "date"] } },
          true
        ),
        stream(COLLECTIONS.dateMonths, { generationId, ...predicate, periodKind: "date-utc" }),
        stream(COLLECTIONS.dateMonthScopes, { generationId, scopeId: scope.scopeId, periodKind: "date-utc" }),
      ];
      try {
        for (;;) {
          const rows = [];
          try {
            for (const source of sources) rows.push(await source.next());
            if (rows.every((row) => !row)) break;
            if (rows.some((row) => !row || !row.key.equals(rows[0].key) || !row.bitmap.isEqual(rows[0].bitmap)))
              throw new Error("UTC-date prepared or historical set validation failed");
            setBlocks += 1;
          } finally {
            for (const row of rows) row?.bitmap.dispose();
          }
        }
      } finally {
        for (const source of sources) await source.close();
      }
      scopes += 1;
    }
  } finally {
    await catalog.close();
  }
  return {
    equal: true,
    setsEqual: true,
    categories: 8,
    scopes,
    setBlocks,
    scope: "all-observed-scopes-and-UTC-date-months",
  };
}

module.exports = { VERSION, buildDateMonths, calculateDateRange, validateDateMonths, validateServiceFacts };
