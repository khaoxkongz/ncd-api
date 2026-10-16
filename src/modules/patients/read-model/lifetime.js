const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const { workerData } = require("node:worker_threads");
const { BSON, Binary, MongoServerError, MongoWriteConcernError } = require("mongodb");

const current = new AsyncLocalStorage();
const results = new WeakMap();
const RAW = Symbol("patients-raw-db");
const WORKER = workerData?.patientsWorker ?? randomUUID();
const OPTION_AT = {
  find: 1,
  aggregate: 1,
  findOne: 1,
  countDocuments: 1,
  distinct: 2,
  insertOne: 1,
  insertMany: 1,
  updateOne: 2,
  updateMany: 2,
  replaceOne: 2,
  deleteOne: 1,
  deleteMany: 1,
  createIndex: 1,
  createIndexes: 1,
  drop: 0,
  listIndexes: 0,
  findOneAndUpdate: 2,
  findOneAndReplace: 2,
  findOneAndDelete: 1,
};
const CURSORS = new Set(["find", "aggregate", "listIndexes"]);
// A server error is a real command response. Driver/runtime errors (including
// client-close or parse errors) do not prove that the remote command ended.
const uncertainCodes = new Set([6, 7, 50, 64, 89, 91, 189, 262, 9001, 10107, 11600, 11602, 13435, 13436]);
const mutations = new Set([
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "createIndex",
  "createIndexes",
  "drop",
  "createCollection",
  "command",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
]);
const unknown = (error, kind) =>
  mutations.has(kind) ||
  !(error instanceof MongoServerError) ||
  error instanceof MongoWriteConcernError ||
  !!error.writeConcernError ||
  uncertainCodes.has(Number(error.code)) ||
  ["RetryableWriteError", "UnknownTransactionCommitResult", "TransientTransactionError"].some((label) =>
    error.hasErrorLabel(label)
  );

async function observeDatabase(db, tag) {
  try {
    const hello = await db.admin().command({ hello: 1 });
    const settings = await db.admin().command({ getCmdLineOpts: 1 });
    if (
      hello.setName ||
      hello.msg === "isdbgrid" ||
      settings.parsed?.security?.authorization === "enabled" ||
      settings.parsed?.security?.keyFile
    )
      return { safe: false, proof: "topology-or-visibility-unverified" };
    const match = (prefix) =>
      Object.fromEntries(
        Object.entries(tag)
          .filter(([key]) => ["worker", "pin", "run"].includes(key))
          .map(([key, value]) => [`${prefix}.${key}`, value])
      );
    const operations = await db.client
      .db("admin")
      .aggregate(
        [
          { $currentOp: { allUsers: true, idleCursors: true, localOps: true } },
          {
            $match: {
              $or: [
                match("command.comment"),
                match("cursor.originatingCommand.comment"),
                match("originatingCommand.comment"),
              ],
            },
          },
        ],
        { maxTimeMS: 3000 }
      )
      .toArray();
    return operations.length
      ? { safe: false, proof: "tagged-database-work-remains" }
      : { safe: true, proof: "application-quiescent-and-standalone-all-user-currentOp-empty" };
  } catch {
    return { safe: false, proof: "database-termination-unverified" };
  }
}

// Every model command is tagged before dispatch, including getMore through the
// driver's inherited cursor comment. A closing response does not close this
// scope: its supervisor waits for actual application and database settlement.
function scope({ db, budget, pin, worker = WORKER }) {
  const pending = new Set(),
    tasks = new Set(),
    cursors = new Set();
  const tag = { patientsModel: 1, worker, pin: pin?.id ?? randomUUID(), generation: pin?.generationId ?? "builder" };
  let uncertain = false,
    missingReply = false,
    uncertainIndex = false,
    stopped = false;
  function operation(fn, { cleanup = false, kind } = {}) {
    if (!cleanup) {
      if (stopped) return Promise.reject(new Error("Read-model work is cancelled"));
    }
    let result,
      dispatched = false;
    try {
      result = Promise.resolve().then(async () => {
        if (!cleanup) {
          if (stopped) throw new Error("Read-model work is cancelled");
          budget.check();
          await budget.flush();
        }
        dispatched = true;
        return fn();
      });
    } catch (error) {
      result = Promise.reject(error);
    }
    pending.add(result);
    void result.then(
      () => pending.delete(result),
      (error) => {
        pending.delete(result);
        if (!dispatched) return;
        if (unknown(error, kind)) uncertain = true;
        if (!(error instanceof MongoServerError)) missingReply = true;
        if (["createIndex", "createIndexes"].includes(kind)) uncertainIndex = true;
      }
    );
    return result;
  }
  const api = {
    tag,
    worker,
    budget,
    run: (fn) => current.run(api, fn),
    task(fn) {
      const result = Promise.resolve().then(() => current.run(api, fn));
      tasks.add(result);
      void result.then(
        () => tasks.delete(result),
        () => tasks.delete(result)
      );
      return result;
    },
    stop() {
      stopped = true;
    },
    resume() {
      stopped = false;
    },
    options(existing = {}) {
      if (stopped) throw new Error("Read-model work is cancelled");
      const remaining = budget.check();
      return { ...existing, comment: tag, maxTimeMS: Math.min(existing.maxTimeMS ?? remaining, remaining) };
    },
    operation,
    cursor(raw) {
      const state = { raw, started: false, exhausted: false };
      let retained, lease;
      cursors.add(state);
      let proxy;
      async function next(accumulated) {
        if (!accumulated) {
          retained?.();
          retained = null;
        }
        // The bounded batch and cumulative toArray result have durable grants
        // before the next database dispatch. BSON/V8 estimates are reservations,
        // not claims of exact decoded heap or complete driver peak visibility.
        await budget.admitAdditional(budget.wireBytes * 4 + 1048576);
        lease = await budget.reserveSerialized(budget.wireBytes);
        state.started = true;
        let row;
        try {
          row = await operation(() => raw.next());
        } catch (error) {
          // A missing reply can mean a still live driver/server operation. Its
          // serialized reservation remains charged until actual scope proof.
          if (!unknown(error)) await lease.release();
          throw error;
        }
        const held = [];
        if (row !== null) {
          const bytes = BSON.calculateObjectSize(row) * 4;
          if (bytes > budget.wireBytes * 4) throw new Error("Cursor document exceeds admitted capacity");
          held.push(budget.hold(row, "decoded", bytes));
          const visit = (value) => {
            if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
              held.push(lease.hold(value));
            } else if (value instanceof Binary) {
              held.push(lease.hold(value.buffer));
            } else if (value && typeof value === "object") for (const child of Object.values(value)) visit(child);
          };
          visit(row);
          const release = () => {
            for (const end of held) end();
          };
          if (accumulated) accumulated.push(release);
          else retained = release;
        }
        // A settled reply transfers the actual unique returned backings into
        // retained ownership. An idle cursor does not retain its unused wire
        // dispatch grant; its next/getMore must acquire a fresh grant first.
        await lease.release();
        lease = null;
        if (row === null) {
          state.exhausted = true;
          cursors.delete(state);
        }
        return row;
      }
      async function close() {
        // Inspect the server cursor ID before close can turn it into zero.
        const knownEnded = !state.started || state.exhausted || raw.id?.isZero() === true;
        await operation(() => raw.close(), { cleanup: true });
        retained?.();
        retained = null;
        if (knownEnded) {
          await lease?.release();
        }
        if (knownEnded) {
          state.exhausted = true;
          cursors.delete(state);
        }
      }
      proxy = new Proxy(raw, {
        get(target, name) {
          if (name === "next") return next;
          if (name === "close") return close;
          if (name === "toArray")
            return async () => {
              const rows = [],
                held = [];
              results.set(rows, () => {
                for (const release of held) release();
              });
              for (;;) {
                const row = await next(held);
                if (row === null) return rows;
                rows.push(row);
              }
            };
          if (name === Symbol.asyncIterator)
            return () => ({
              async next() {
                const value = await next();
                return value === null ? { done: true } : { value, done: false };
              },
              async return() {
                await close();
                return { done: true };
              },
            });
          const value = Reflect.get(target, name, target);
          return typeof value === "function"
            ? (...args) => {
                const result = value.apply(target, args);
                return result === target ? proxy : result;
              }
            : value;
        },
      });
      return proxy;
    },
    async drain() {
      while (tasks.size || pending.size) await Promise.allSettled([...tasks, ...pending]);
      for (const cursor of cursors) {
        try {
          await operation(() => cursor.raw.close(), { cleanup: true });
        } catch {
          uncertain = true;
        }
        if (!cursor.started || cursor.exhausted) cursors.delete(cursor);
      }
      if (missingReply) return { safe: false, proof: "command-dispatch-outcome-unverified" };
      if (uncertainIndex) return { safe: false, proof: "index-completion-and-tag-association-unverified" };
      if (!uncertain && !cursors.size) {
        budget.releaseAllocations();
        budget.capacity?.settledPhase();
        return { safe: true, proof: "all-commands-settled-and-cursors-exhausted" };
      }
      // Application work is quiescent here. Driver close/kill acknowledgments
      // alone are insufficient; independently inspect executing and idle work.
      const proof = await observeDatabase(db, tag);
      if (proof.safe) {
        budget.releaseAllocations();
        budget.capacity?.settledPhase();
      }
      return proof;
    },
  };
  return api;
}

function trackedDb(db) {
  if (db[RAW]) return db;
  const collections = new Map();
  return new Proxy(db, {
    get(target, name) {
      if (name === RAW) return target;
      if (name === "collection")
        return (collectionName) => {
          if (collections.has(collectionName)) return collections.get(collectionName);
          const raw = target.collection(collectionName);
          const collection = new Proxy(raw, {
            get(selected, method) {
              const value = Reflect.get(selected, method, selected);
              if (typeof value !== "function") return value;
              return (...args) => {
                const owner = current.getStore();
                if (!owner || OPTION_AT[method] === undefined) return value.apply(selected, args);
                const index = OPTION_AT[method];
                args[index] = owner.options(args[index]);
                if (CURSORS.has(method)) return owner.cursor(value.apply(selected, args));
                return owner.operation(() => value.apply(selected, args), { kind: method });
              };
            },
          });
          collections.set(collectionName, collection);
          return collection;
        };
      const value = Reflect.get(target, name, target);
      if (["createCollection", "command", "listCollections"].includes(name))
        return (...args) => {
          const owner = current.getStore();
          if (!owner) return value.apply(target, args);
          args[1] = owner.options(args[1]);
          if (name === "command") args[0] = { ...args[0], comment: owner.tag, maxTimeMS: args[1].maxTimeMS };
          if (name === "listCollections") return owner.cursor(value.apply(target, args));
          return owner.operation(() => value.apply(target, args), { kind: name });
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function within(promise, budget, signal) {
  let timer, abort;
  try {
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(new Error("Read-model deadline or cancellation"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, budget.check());
      timer.unref();
    });
    return await Promise.race([promise, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// Clearing the interval prevents future dispatch. Every renewal already queued
// by it remains owned until its actual asynchronous continuation has ended.
function renewals(fn, intervalMS, onError) {
  const pending = new Set();
  let failed = false;
  const timer = setInterval(() => {
    const work = Promise.resolve().then(fn);
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      (error) => {
        failed = true;
        pending.delete(work);
        onError?.(error);
      }
    );
  }, intervalMS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    while (pending.size) await Promise.allSettled(pending);
    return { safe: !failed, proof: failed ? "renewal-outcome-unverified" : "queued-renewals-settled" };
  };
}

module.exports = {
  scope,
  trackedDb,
  WORKER,
  within,
  renewals,
  observeDatabase,
  rawDb: (db) => db[RAW] ?? db,
  releaseRows: (rows) => {
    results.get(rows)?.();
    results.delete(rows);
  },
};
