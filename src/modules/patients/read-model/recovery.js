const { createHash, createHmac, createPublicKey } = require("node:crypto");
const { performance: monotonicClock } = require("node:perf_hooks");
const { BSON } = require("mongodb");
const { COLLECTIONS, VERSIONS, BSON_OPTIONS } = require("./schema");

const JOURNAL = "patients_recovery_journal";
const GROUPS = ["A", "B", "C", "D"];
const digest = (value) => createHash("sha256").update(BSON.serialize(value)).digest("hex");
const canonical = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
function journalSeal(document) {
  const { seal: _seal, ...content } = document;
  return digest(content);
}

function identity(sourceCut, context, budget) {
  if (!Buffer.isBuffer(sourceCut?.manifest) || !Buffer.isBuffer(sourceCut?.signature)) return null;
  if (sourceCut.manifest.length * 4 + sourceCut.signature.length > budget.maxSerializedBytes)
    throw new Error("Recovery source evidence exceeds buffer budget");
  const manifest = BSON.deserialize(sourceCut.manifest);
  const key = context.trustedProducers?.[manifest.producer];
  const publicKey = key?.type === "public" ? key : key ? createPublicKey(key) : null;
  return {
    sourceKey: digest({ manifest: sourceCut.manifest, signature: sourceCut.signature }),
    policyKey: digest({
      versions: VERSIONS,
      producerKey: publicKey?.export({ type: "spki", format: "der" }) ?? null,
      domain: context.supportedDomainRevision,
      history: context.supportedHistory,
      identity: createHmac("sha256", context.identitySecret ?? "")
        .update("patients-recovery-policy-v1")
        .digest("hex"),
    }),
    budgetKey: digest(canonical(budget)),
  };
}

async function find(db, control, sourceIdentity, budget) {
  if (!sourceIdentity || !(await control.exists(budget))) return null;
  const document = await control.read(budget);
  if (document.builder) return null;
  for (const slot of document.slots.filter((item) => ["failed", "ready"].includes(item.state) && item.settled)) {
    const journal = await db.collection(JOURNAL).findOne({ _id: slot.generationId }, budget.options());
    if (journal?.identity.sourceKey === sourceIdentity.sourceKey) {
      if (journal.version !== "patients-recovery-v1" || journal.seal !== journalSeal(journal))
        throw new Error("Recovery journal integrity failed");
      if (
        journal.identity.policyKey !== sourceIdentity.policyKey ||
        journal.identity.budgetKey !== sourceIdentity.budgetKey
      )
        throw new Error("Recovery policy or fixed budget changed");
      return journal;
    }
  }
  return null;
}

async function inventory(db, names, generationId, budget) {
  const result = {};
  for (const name of names) {
    const staged = name.startsWith("patients_stage_");
    const hash = createHash("sha256");
    let count = 0;
    for await (const row of db
      .collection(name)
      .find(staged ? {} : { generationId }, budget.options({ ...BSON_OPTIONS, collation: { locale: "simple" } }))
      .sort({ _id: 1 })) {
      const bytes = BSON.serialize(row);
      budget.serialized(bytes.length * 4 + 65536);
      hash.update(bytes);
      count += 1;
    }
    let indexes = [];
    try {
      indexes = await db.collection(name).listIndexes(budget.options()).toArray();
    } catch (error) {
      if (error.code !== 26) throw error;
    }
    result[name] = { count, sha256: hash.digest("hex"), indexes };
  }
  return result;
}

function createRecovery({
  db,
  generationId,
  identity: sourceIdentity,
  claim,
  previous,
  clock,
  timeZone,
  budget,
  startedAt,
}) {
  const prefix = `patients_stage_${generationId.replaceAll("-", "")}`;
  const groups = previous?.groups ?? {};
  const verified = [];
  const attemptStart = monotonicClock.now();
  const journal = previous ?? {
    _id: generationId,
    version: "patients-recovery-v1",
    revision: 0,
    identity: sourceIdentity,
    capturedClock: clock.toISOString(),
    timeZone,
    startedAt,
    elapsedMS: 0,
    lastWallAt: startedAt,
    groups,
  };
  const elapsedBase = Math.max(journal.elapsedMS, Date.now() - journal.startedAt);
  for (const [key, value] of Object.entries(journal.resources ?? {}))
    if (key.startsWith("peak") && typeof value === "number")
      budget.metrics[key] = Math.max(budget.metrics[key] ?? 0, value);
  const collection = db.collection(JOURNAL);
  const names = {
    A: [`${prefix}_raw`],
    B: [`${prefix}_summary`],
    C: [
      ...Object.values(COLLECTIONS).filter((name) => ![COLLECTIONS.generations, COLLECTIONS.snapshots].includes(name)),
      `${prefix}_raw`,
      `${prefix}_summary`,
      `${prefix}_values`,
      `${prefix}_edges`,
    ],
    D: Object.values(COLLECTIONS).filter((name) => name !== COLLECTIONS.generations),
  };
  function remaining() {
    if (Date.now() < journal.lastWallAt) throw new Error("Recovery clock moved backwards");
    return (
      budget.limits.maxTimeMS -
      Math.max(Date.now() - journal.startedAt, elapsedBase + monotonicClock.now() - attemptStart)
    );
  }
  async function save() {
    const revision = journal.revision;
    journal.revision += 1;
    journal.claim = claim;
    journal.elapsedMS = budget.limits.maxTimeMS - remaining();
    journal.lastWallAt = Date.now();
    journal.resources = { ...budget.metrics };
    journal.seal = journalSeal(journal);
    budget.serialized(BSON.serialize(journal).length * 4 + 65536);
    try {
      if (!previous && revision === 0)
        await collection.insertOne(journal, budget.options({ writeConcern: { w: "majority" } }));
      else {
        const result = await collection.replaceOne(
          { _id: generationId, revision },
          journal,
          budget.options({ writeConcern: { w: "majority" } })
        );
        if (result.matchedCount !== 1) throw new Error("Recovery journal ownership changed");
      }
    } catch (error) {
      const actual = await collection.findOne({ _id: generationId }, budget.options());
      if (actual?.revision !== journal.revision || digest(actual) !== digest(journal)) throw error;
    }
  }
  async function discard(group) {
    if (group !== "D") {
      for (const name of Object.values(COLLECTIONS).filter((name) => name !== COLLECTIONS.generations)) {
        await db.collection(name).deleteMany({ generationId }, budget.options());
        if (await db.collection(name).countDocuments({ generationId }, budget.options()))
          throw new Error("Partial output cleanup incomplete");
      }
      const keep = new Set(
        group === "A" ? [] : group === "B" ? [`${prefix}_raw`] : [`${prefix}_raw`, `${prefix}_summary`]
      );
      for await (const { name } of db.listCollections({}, budget.options({ nameOnly: true }))) {
        if (name.startsWith(`${prefix}_`) && !keep.has(name)) await db.collection(name).drop(budget.options());
      }
      for await (const { name } of db.listCollections({}, budget.options({ nameOnly: true }))) {
        if (name.startsWith(`${prefix}_`) && !keep.has(name)) throw new Error("Partial staging cleanup incomplete");
      }
    } else {
      await db.collection(COLLECTIONS.snapshots).deleteMany({ generationId }, budget.options());
    }
    for (const item of GROUPS.slice(GROUPS.indexOf(group))) delete groups[item];
  }
  return {
    journal,
    verified,
    remaining,
    get: (group) => groups[group]?.metadata,
    completed: (group) => verified.includes("D") || verified.includes(group),
    async initialize() {
      if (!previous) await save();
    },
    async prepare() {
      if (previous) {
        // Full validated output no longer depends on staging that a finishing
        // attempt may already have removed. Verify D before its old inputs.
        if (
          groups.D &&
          BSON.serialize(await inventory(db, names.D, generationId, budget)).equals(BSON.serialize(groups.D.inventory))
        ) {
          verified.push("D");
          await save();
          return;
        }
        for (const group of GROUPS) {
          const saved = groups[group];
          if (
            !saved ||
            !BSON.serialize(await inventory(db, names[group], generationId, budget)).equals(
              BSON.serialize(saved.inventory)
            )
          ) {
            await discard(group);
            break;
          }
          verified.push(group);
        }
      }
      await save();
    },
    async checkpoint(group, metadata, stages) {
      groups[group] = {
        inventory: await inventory(db, names[group], generationId, budget),
        metadata,
        stages: [...stages],
      };
      await save();
    },
    stage: (name) =>
      Object.values(groups)
        .flatMap((group) => group.stages)
        .find((stage) => stage.name === name),
    report: () => ({ verifiedGroups: [...verified], capturedClock: journal.capturedClock, timeZone: journal.timeZone }),
  };
}

module.exports = { JOURNAL, identity, find, createRecovery };
