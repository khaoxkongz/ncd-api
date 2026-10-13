/* eslint-disable prettier/prettier */
const dns = require("node:dns").promises;
const fs = require("node:fs");
const { MongoClient } = require("mongodb");
const { parse } = require("dotenv");
const { expand } = require("dotenv-expand");

const DATABASE = "ncds_perf_synthetic";
const COLLECTIONS = ["NCD_SUMMARY", "NCD_Summary_Temp_Table"];
const QUOTA_BYTES = 512 * 1024 * 1024;
const DATABASE_LIMIT_BYTES = 100 * 1024 * 1024;

async function doh(name, type) {
  const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("DNS over HTTPS transport failed");
  const answer = await response.json();
  if (answer.Status !== 0) throw new Error("DNS over HTTPS returned no valid answer");
  return (answer.Answer || []).filter((record) => record.type === type);
}

async function connectSynthetic() {
  const settings = expand({ parsed: parse(fs.readFileSync(".env")), processEnv: { ...process.env } }).parsed;
  const configured = new URL(process.env.MONGO_URI || settings.MONGO_URI);
  if (configured.protocol !== "mongodb+srv:" || configured.hostname !== "dev.3blak.mongodb.net") {
    throw new Error("This workflow requires the accepted Atlas cluster");
  }
  for (const [key, value] of configured.searchParams) {
    const option = key.toLowerCase();
    if (
      (["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"].includes(option) &&
        value !== "false") ||
      (["tls", "ssl"].includes(option) && value !== "true")
    ) {
      throw new Error("TLS and certificate validation must remain enabled");
    }
  }
  configured.pathname = `/${DATABASE}`;
  let method = "normal SRV DNS";
  let normalDnsError = null;
  let options = {};
  let uri = configured.toString();
  try {
    await dns.resolveSrv(`_mongodb._tcp.${configured.hostname}`);
    await dns.resolveTxt(configured.hostname);
  } catch (error) {
    normalDnsError = error.code || error.name;
    method = "Google DNS over HTTPS (SRV, TXT, A); TLS certificate validation enabled";
    const [srv, txt] = await Promise.all([
      doh(`_mongodb._tcp.${configured.hostname}`, 33),
      doh(configured.hostname, 16),
    ]);
    if (!srv.length) throw new Error("No Atlas SRV records");
    const hosts = srv.map((record) => {
      const [, , port, rawHost] = record.data.split(/\s+/);
      const host = rawHost.replace(/\.$/, "");
      if (!host.endsWith(".3blak.mongodb.net") || !/^\d+$/.test(port)) {
        throw new Error("Unexpected Atlas SRV target");
      }
      return `${host}:${port}`;
    });
    const query = new URLSearchParams();
    for (const record of txt) {
      const value =
        record.data
          .match(/"([^"]*)"/g)
          ?.map((part) => part.slice(1, -1))
          .join("") || record.data;
      for (const [key, val] of new URLSearchParams(value)) {
        if (!["authSource", "replicaSet", "loadBalanced"].includes(key)) throw new Error("Unexpected Atlas TXT option");
        query.set(key, val);
      }
    }
    for (const [key, val] of configured.searchParams) query.set(key, val);
    query.set("tls", "true");
    uri = `mongodb://${configured.username}:${configured.password}@${hosts.join(",")}/${DATABASE}?${query}`;
    const addresses = new Map();
    options = {
      lookup(hostname, lookupOptions, callback) {
        if (typeof lookupOptions === "function") {
          callback = lookupOptions;
          lookupOptions = {};
        }
        const result =
          addresses.get(hostname) ||
          doh(hostname, 1).then((records) => {
            if (!records.length) throw new Error("Atlas address lookup failed");
            return records.map((record) => ({ address: record.data, family: 4 }));
          });
        addresses.set(hostname, result);
        result.then(
          (items) => {
            if (lookupOptions.all) callback(null, items);
            else callback(null, items[0].address, 4);
          },
          (error) => callback(error)
        );
      },
    };
  }
  const client = new MongoClient(uri, { ...options, serverSelectionTimeoutMS: 15000, maxPoolSize: 50 });
  try {
    await client.connect();
    const db = client.db(DATABASE);
    assertDatabase(db);
    await db.command({ ping: 1 });
    return {
      client,
      db,
      connection: { method, normalDnsError, tlsCertificateValidation: true, database: db.databaseName },
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

function assertDatabase(db) {
  if (db.databaseName !== DATABASE) throw new Error("Synthetic database guard failed");
}

async function sharedUsage(client) {
  const list = await client.db("admin").admin().listDatabases();
  let bytes = 0;
  for (const entry of list.databases) {
    if (["admin", "local", "config"].includes(entry.name)) continue;
    const stats = await client.db(entry.name).command({ dbStats: 1, scale: 1 });
    bytes += stats.dataSize + stats.indexSize;
  }
  return {
    bytes,
    method: "Sum of dbStats dataSize plus indexSize for all visible user databases",
    databaseCount: list.databases.filter((entry) => !["admin", "local", "config"].includes(entry.name)).length,
  };
}

async function inspectEnvironment(client, db) {
  assertDatabase(db);
  const [build, hello, stats, shared, collections] = await Promise.all([
    db.command({ buildInfo: 1 }),
    db.command({ hello: 1 }),
    db.command({ dbStats: 1, scale: 1 }),
    sharedUsage(client),
    db.listCollections({}, { nameOnly: true }).toArray(),
  ]);
  const indexes = {};
  const collectionCounts = {};
  for (const { name } of collections) {
    if (!COLLECTIONS.includes(name)) throw new Error("Unexpected collection in synthetic database; refusing writes");
    indexes[name] = await db.collection(name).listIndexes().toArray();
    collectionCounts[name] = await db.collection(name).countDocuments();
  }
  return {
    mongoVersion: build.version,
    topology: hello.setName ? "replica set" : "other",
    nodes: hello.hosts?.length,
    database: db.databaseName,
    dataBytes: stats.dataSize,
    indexBytes: stats.indexSize,
    shared,
    quotaBytes: QUOTA_BYTES,
    collections: collections.map((entry) => entry.name),
    collectionCounts,
    indexes,
  };
}

function checkStorage({ projectedDataBytes, indexAllowanceBytes, sharedBytes, existingSyntheticBytes = 0 }) {
  const proposed = projectedDataBytes + indexAllowanceBytes;
  if (proposed > DATABASE_LIMIT_BYTES) throw new Error("Synthetic database exceeds 100 MiB budget");
  if (sharedBytes - existingSyntheticBytes + proposed > QUOTA_BYTES * 0.75) {
    throw new Error("Shared storage reserve would be less than 25 percent");
  }
  return {
    projectedDataBytes,
    indexAllowanceBytes,
    projectedDatabaseBytes: proposed,
    minimumSharedReserveBytes: QUOTA_BYTES * 0.25,
  };
}

async function removeSynthetic(db, manifest, selectedCollections = manifest.collections) {
  assertDatabase(db);
  if (
    manifest.database !== DATABASE ||
    !Array.isArray(manifest.collections) ||
    manifest.collections.length !== 2 ||
    COLLECTIONS.some((name) => !manifest.collections.includes(name))
  )
    throw new Error("Synthetic manifest guard failed");
  const names = await db.listCollections({}, { nameOnly: true }).toArray();
  if (names.some(({ name }) => !manifest.collections.includes(name)))
    throw new Error("Unlisted collection guard failed");
  if (!Array.isArray(selectedCollections) || selectedCollections.some((name) => !manifest.collections.includes(name))) {
    throw new Error("Selected collection guard failed");
  }
  for (const name of selectedCollections) await db.collection(name).deleteMany({});
}

module.exports = {
  DATABASE,
  COLLECTIONS,
  connectSynthetic,
  assertDatabase,
  inspectEnvironment,
  sharedUsage,
  checkStorage,
  removeSynthetic,
};
