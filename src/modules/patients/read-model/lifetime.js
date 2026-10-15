const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");
const { MongoServerError } = require("mongodb");

const current = new AsyncLocalStorage();
const RAW = Symbol("patients-raw-db");
const WORKER = randomUUID();
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
const unknown = (error) => !(error instanceof MongoServerError);

// Every model command is tagged before dispatch, including getMore through the
// driver's inherited cursor comment. A closing response does not close this
// scope: its supervisor waits for actual application and database settlement.
function scope({ db, budget, pin, worker = WORKER }) {
  const pending = new Set(),
    tasks = new Set(),
    cursors = new Set();
  const tag = { patientsModel: 1, worker, pin: pin?.id ?? randomUUID(), generation: pin?.generationId ?? "builder" };
  let uncertain = false,
    stopped = false;
  function operation(fn, { cleanup = false } = {}) {
    if (!cleanup) {
      if (stopped) return Promise.reject(new Error("Read-model work is cancelled"));
      budget.check();
    }
    let result;
    try {
      result = Promise.resolve(fn());
    } catch (error) {
      result = Promise.reject(error);
    }
    pending.add(result);
    void result.then(
      () => pending.delete(result),
      (error) => {
        pending.delete(result);
        if (unknown(error)) uncertain = true;
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
    options(existing = {}) {
      if (stopped) throw new Error("Read-model work is cancelled");
      const remaining = budget.check();
      return { ...existing, comment: tag, maxTimeMS: Math.min(existing.maxTimeMS ?? remaining, remaining) };
    },
    operation,
    cursor(raw) {
      const state = { raw, started: false, exhausted: false };
      cursors.add(state);
      let proxy;
      async function next() {
        state.started = true;
        const row = await operation(() => raw.next());
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
              const rows = [];
              for (;;) {
                const row = await next();
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
      if (!uncertain && !cursors.size) return { safe: true, proof: "all-commands-settled-and-cursors-exhausted" };
      // Application work is quiescent here. Driver close/kill acknowledgments
      // alone are insufficient; independently inspect executing and idle work.
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
        const operations = await db.client
          .db("admin")
          .aggregate(
            [
              { $currentOp: { allUsers: true, idleCursors: true, localOps: true } },
              {
                $match: {
                  $or: [
                    { "command.comment.worker": worker, "command.comment.pin": tag.pin },
                    {
                      "cursor.originatingCommand.comment.worker": worker,
                      "cursor.originatingCommand.comment.pin": tag.pin,
                    },
                    { "originatingCommand.comment.worker": worker, "originatingCommand.comment.pin": tag.pin },
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
                return owner.operation(() => value.apply(selected, args));
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
          return owner.operation(() => value.apply(target, args));
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

module.exports = { scope, trackedDb, WORKER, within, rawDb: (db) => db[RAW] ?? db };
