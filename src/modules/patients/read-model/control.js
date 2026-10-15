const { randomUUID } = require("node:crypto");
const { BSON, Long } = require("mongodb");

const NAME = "patients_model_control";
const LEASE_MS = 120000;
const HEARTBEAT_MS = 15000;
const MAX_PINS = 64;
const MAX_BYTES = 1048576;
const MAX_COUNTER = 2n ** 63n - 1n;
const buildContext = new (require("node:async_hooks").AsyncLocalStorage)();

function next(value) {
  const integer = Long.isLong(value) ? value.toBigInt() : BigInt(value);
  if (integer < 0n || integer >= MAX_COUNTER) throw new Error("Control counter exhausted");
  return Long.fromBigInt(integer + 1n);
}

function identity(control) {
  return control.active
    ? { generationId: control.active.generationId, publicationVersion: control.publicationVersion.toString() }
    : null;
}

function sameActive(control, expected) {
  const active = identity(control);
  return active === null
    ? expected === null
    : active.generationId === expected?.generationId &&
        active.publicationVersion === String(expected.publicationVersion);
}

function validate(document) {
  if (
    document?._id !== "patients" ||
    document.version !== "generation-control-v1" ||
    !Long.isLong(document.revision) ||
    !Long.isLong(document.publicationVersion) ||
    !Long.isLong(document.fence) ||
    !Array.isArray(document.slots) ||
    document.slots.length !== 2 ||
    !Array.isArray(document.pins) ||
    document.pins.length > MAX_PINS ||
    BSON.serialize(document).length > MAX_BYTES
  )
    throw new Error("Invalid or overflowing read-model control");
  for (const counter of [document.revision, document.publicationVersion, document.fence])
    if (counter.toBigInt() < 0n || counter.toBigInt() > MAX_COUNTER) throw new Error("Invalid control counter");
  for (const pin of document.pins)
    if (
      typeof pin.id !== "string" ||
      pin.id.length > 128 ||
      typeof pin.worker !== "string" ||
      pin.worker.length > 128 ||
      typeof pin.generationId !== "string" ||
      pin.generationId.length > 128 ||
      !Number.isFinite(pin.leaseUntil)
    )
      throw new Error("Invalid pin descriptor");
  const generations = new Set();
  for (const [index, slot] of document.slots.entries()) {
    if (
      slot.index !== index ||
      !["free", "building", "ready", "active", "retired", "failed", "deleting"].includes(slot.state)
    )
      throw new Error("Invalid model slot");
    if (slot.state !== "free") {
      if (
        typeof slot.generationId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(slot.generationId) ||
        generations.has(slot.generationId)
      )
        throw new Error("Invalid or duplicated generation slot");
      generations.add(slot.generationId);
    }
    if (
      ["ready", "active", "retired"].includes(slot.state) &&
      (slot.settled !== true || !/^[a-f0-9]{64}$/.test(slot.seal))
    )
      throw new Error("Unsealed readable slot");
  }
  const active = document.slots.filter((slot) => slot.state === "active");
  if (
    document.active
      ? active.length !== 1 ||
        active[0].generationId !== document.active.generationId ||
        active[0].seal !== document.active.seal
      : active.length !== 0
  )
    throw new Error("Inconsistent active model slot");
  if (
    new Set(document.pins.map((pin) => pin.id)).size !== document.pins.length ||
    document.pins.some((pin) => !generations.has(pin.generationId) || !["live", "suspect"].includes(pin.state))
  )
    throw new Error("Unowned or duplicated pin");
  if (!Array.isArray(document.transitions) || document.transitions.length > 16)
    throw new Error("Unbounded control transitions");
}

function createControl({ db, now = () => Date.now(), worker }) {
  const collection = db.collection(NAME);
  const options = (budget, extra = {}) => ({
    readPreference: "primary",
    ...budget.options(extra),
    ...(worker ? { comment: { patientsModel: 1, worker, kind: "control" } } : {}),
  });
  async function read(budget) {
    const document = await collection.findOne({ _id: "patients" }, options(budget, { promoteLongs: false }));
    if (!document) throw new Error("Read-model control unavailable");
    validate(document);
    return document;
  }
  async function exists(budget) {
    return !!(await collection.findOne({ _id: "patients" }, options(budget, { projection: { _id: 1 } })));
  }
  async function initialize(budget) {
    const initial = {
      _id: "patients",
      version: "generation-control-v1",
      revision: Long.ZERO,
      publicationVersion: Long.ZERO,
      fence: Long.ZERO,
      active: null,
      builder: null,
      slots: [
        { index: 0, state: "free" },
        { index: 1, state: "free" },
      ],
      pins: [],
      transitions: [],
    };
    validate(initial);
    await collection.updateOne(
      { _id: "patients" },
      { $setOnInsert: initial },
      options(budget, { upsert: true, writeConcern: { w: "majority", wtimeoutMS: 3000 } })
    );
  }
  async function change(budget, operation, id = randomUUID()) {
    for (;;) {
      budget.check();
      const previous = await read(budget);
      const completed = previous.transitions.find((item) => item.id === id);
      if (completed) return completed.result;
      const document = BSON.deserialize(BSON.serialize(previous), { promoteLongs: false });
      const result = operation(document);
      document.revision = next(previous.revision);
      document.transitions = [...document.transitions.slice(-15), { id, result }];
      validate(document);
      try {
        const updated = await collection.replaceOne(
          { _id: "patients", revision: previous.revision },
          document,
          options(budget, { writeConcern: { w: "majority", wtimeoutMS: 3000 } })
        );
        if (updated.matchedCount === 1) return result;
      } catch (error) {
        // A failed transport can follow a successful atomic write. Read back the
        // same logical transition; never create a second pin/publication blindly.
        error.controlOutcome = "unknown";
        let observed;
        try {
          observed = await read(budget);
        } catch {
          throw error;
        }
        const recorded = observed.transitions.find((item) => item.id === id);
        if (recorded) return recorded.result;
        error.controlOutcome = "not-recorded";
        throw error;
      }
    }
  }
  const readable = (document, generationId) =>
    document.slots.some((slot) => slot.generationId === generationId && ["active", "retired"].includes(slot.state));
  function appendPin(document, pin) {
    if (document.pins.length >= MAX_PINS) throw new Error("Read-model pin limit exceeded");
    document.pins.push(pin);
    return pin;
  }
  return Object.freeze({
    read,
    exists,
    initialize,
    change,
    async claim(generationId, owner, budget, worker) {
      await initialize(budget);
      return change(budget, (document) => {
        if (document.builder) throw new Error("A fenced builder still owns outstanding work");
        const slot = document.slots.find((item) => item.state === "free");
        if (!slot) throw new Error("Both read-model slots are occupied");
        document.fence = next(document.fence);
        const run = randomUUID();
        document.builder = { owner, run, generationId, worker, fence: document.fence, leaseUntil: now() + LEASE_MS };
        Object.assign(slot, {
          generationId,
          owner,
          run,
          worker,
          fence: document.fence,
          state: "building",
          settled: false,
        });
        return { generationId, owner, run, fence: document.fence.toString(), slot: slot.index };
      });
    },
    async resume(generationId, owner, worker, budget) {
      return change(budget, (document) => {
        const slot = document.slots.find((item) => item.generationId === generationId);
        if (
          document.builder ||
          !slot ||
          !["failed", "ready"].includes(slot.state) ||
          !slot.settled ||
          document.pins.some((pin) => pin.generationId === generationId)
        )
          throw new Error("Recovery predecessor is still owned; resume blocked");
        document.fence = next(document.fence);
        const run = randomUUID();
        document.builder = { owner, run, generationId, worker, fence: document.fence, leaseUntil: now() + LEASE_MS };
        Object.assign(slot, {
          owner,
          run,
          worker,
          fence: document.fence,
          state: "building",
          settled: false,
          seal: null,
        });
        return { generationId, owner, run, fence: document.fence.toString(), slot: slot.index };
      });
    },
    async guardBuild(claim, budget) {
      const document = await read(budget);
      if (
        !document.builder ||
        document.builder.owner !== claim.owner ||
        document.builder.run !== claim.run ||
        document.builder.generationId !== claim.generationId ||
        document.fence.toString() !== claim.fence ||
        document.builder.leaseUntil < now()
      )
        throw new Error("Stale builder fencing or lease");
      return document;
    },
    async finishBuild(claim, state, seal, settled, budget) {
      return change(budget, (document) => {
        const slot = document.slots.find((item) => item.generationId === claim.generationId);
        if (
          !slot ||
          slot.run !== claim.run ||
          slot.owner !== claim.owner ||
          document.fence.toString() !== claim.fence ||
          document.builder?.run !== claim.run
        )
          throw new Error("Stale builder completion");
        Object.assign(slot, { state, seal, settled });
        if (settled) document.builder = null;
        return { generationId: claim.generationId, state };
      });
    },
    async heartbeatBuilder(claim, budget) {
      return change(budget, (document) => {
        if (
          document.builder?.run !== claim.run ||
          document.builder.owner !== claim.owner ||
          document.fence.toString() !== claim.fence
        )
          throw new Error("Stale builder heartbeat");
        document.builder.leaseUntil = now() + LEASE_MS;
        return true;
      });
    },
    async publish(candidate, expected, owner, budget) {
      return change(
        budget,
        (document) => {
          const previous = document.slots.find(
            (item) => item.publication?.id === `publish:${candidate.generationId}:${candidate.control?.run}`
          );
          if (previous) return previous.publication.result;
          if (!sameActive(document, expected)) throw new Error("Expected active generation changed");
          const slot = document.slots.find((item) => item.generationId === candidate.generationId);
          if (
            !slot ||
            slot.state !== "ready" ||
            !slot.settled ||
            slot.owner !== owner ||
            slot.run !== candidate.control?.run ||
            document.fence.toString() !== candidate.control?.fence ||
            slot.seal !== candidate.seal ||
            document.builder
          )
            throw new Error("Incomplete or stale candidate publication");
          if (document.active)
            document.slots.find((item) => item.generationId === document.active.generationId).state = "retired";
          slot.state = "active";
          document.publicationVersion = next(document.publicationVersion);
          document.active = { generationId: slot.generationId, seal: slot.seal };
          const result = identity(document);
          slot.publication = { id: `publish:${candidate.generationId}:${candidate.control?.run}`, result };
          return result;
        },
        `publish:${candidate.generationId}:${candidate.control?.run}`
      );
    },
    async rollback(target, expected, budget) {
      return change(budget, (document) => {
        if (!sameActive(document, expected)) throw new Error("Expected active generation changed");
        const slot =
          target === "legacy"
            ? null
            : document.slots.find(
                (item) => item.generationId === target && item.state === "retired" && item.settled && item.seal
              );
        if (target !== "legacy" && !slot) throw new Error("Rollback generation is not retained");
        if (document.active)
          document.slots.find((item) => item.generationId === document.active.generationId).state = "retired";
        document.active = slot ? { generationId: slot.generationId, seal: slot.seal } : null;
        if (slot) slot.state = "active";
        document.publicationVersion = next(document.publicationVersion);
        return identity(document);
      });
    },
    async pin(worker, budget, claim) {
      const id = randomUUID();
      for (;;) {
        const selection = await read(budget);
        const selected = claim ? claim.generationId : selection.active?.generationId;
        if (!selected) throw new Error("No active read-model generation");
        const attempt = await change(budget, (document) => {
          if (claim) {
            if (
              document.builder?.run !== claim.run ||
              document.builder.owner !== claim.owner ||
              document.fence.toString() !== claim.fence
            )
              throw new Error("Candidate is not owned by this builder");
          } else if (
            document.active?.generationId !== selected ||
            !document.publicationVersion.equals(selection.publicationVersion) ||
            !readable(document, selected)
          )
            return null;
          return appendPin(document, {
            id,
            worker,
            generationId: selected,
            kind: claim ? "validation" : "reader",
            state: "live",
            leaseUntil: now() + LEASE_MS,
          });
        });
        if (attempt) return { ...attempt, descriptorSeal: claim ? null : selection.active.seal };
      }
    },
    async fork(parent, budget) {
      return change(budget, (document) => {
        const live = document.pins.find(
          (pin) =>
            pin.id === parent.id &&
            pin.worker === parent.worker &&
            pin.generationId === parent.generationId &&
            pin.state === "live" &&
            pin.leaseUntil >= now()
        );
        const candidate = live?.kind === "validation" && document.builder?.generationId === parent.generationId;
        if (!live || (!readable(document, parent.generationId) && !candidate))
          throw new Error("No live readable parent pin for shared work");
        return appendPin(document, {
          id: randomUUID(),
          worker: parent.worker,
          generationId: parent.generationId,
          kind: "shared",
          parent: parent.id,
          state: "live",
          leaseUntil: now() + LEASE_MS,
        });
      });
    },
    async renew(pin, budget) {
      return change(budget, (document) => {
        const selected = document.pins.find(
          (item) => item.id === pin.id && item.worker === pin.worker && item.generationId === pin.generationId
        );
        if (!selected) throw new Error("Pin disappeared");
        selected.leaseUntil = now() + LEASE_MS;
        return true;
      });
    },
    async link(parent, work, budget) {
      return change(budget, (document) => {
        const pin = document.pins.find((item) => item.id === parent.id && item.worker === parent.worker);
        const shared = document.pins.find((item) => item.id === work.id && item.kind === "shared");
        if (!pin || !shared || pin.generationId !== shared.generationId)
          throw new Error("Shared work ownership changed");
        pin.work = shared.id;
        return true;
      });
    },
    async release(pin, budget) {
      return change(budget, (document) => {
        document.pins = document.pins.filter(
          (item) => !(item.id === pin.id && item.worker === pin.worker && item.generationId === pin.generationId)
        );
        return true;
      });
    },
    async suspect(pin, budget) {
      return change(budget, (document) => {
        const selected = document.pins.find((item) => item.id === pin.id && item.worker === pin.worker);
        if (selected) selected.state = "suspect";
        return true;
      });
    },
    async detectSuspects(budget) {
      return change(budget, (document) => {
        for (const pin of document.pins) if (pin.leaseUntil < now()) pin.state = "suspect";
        if (document.builder && document.builder.leaseUntil < now()) document.builder.state = "suspect";
        return true;
      });
    },
    async markDeleting(generationId, budget) {
      return change(budget, (document) => {
        const slot = document.slots.find((item) => item.generationId === generationId);
        if (
          !slot ||
          !["retired", "failed", "deleting", "ready"].includes(slot.state) ||
          !slot.settled ||
          document.active?.generationId === generationId ||
          document.builder?.generationId === generationId ||
          document.pins.some((pin) => pin.generationId === generationId)
        )
          throw new Error("Generation still owned or readable; cleanup blocked");
        slot.state = "deleting";
        return true;
      });
    },
    async free(generationId, budget) {
      return change(budget, (document) => {
        const index = document.slots.findIndex(
          (slot) => slot.generationId === generationId && slot.state === "deleting"
        );
        if (index < 0 || document.pins.some((pin) => pin.generationId === generationId))
          throw new Error("Deleting slot changed");
        document.slots[index] = { index, state: "free" };
        return true;
      });
    },
  });
}

module.exports = { createControl, NAME, HEARTBEAT_MS, LEASE_MS, buildContext };
