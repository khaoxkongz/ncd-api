const fs = require("node:fs/promises");
const { createHash, verify } = require("node:crypto");
const { BSON } = require("mongodb");
const { BSON_OPTIONS } = require("./schema");

async function openSource(sourceCut, budget, context) {
  // A readOnly flag, a collection name, matching counts, and hashes on a moving
  // collection are deliberately insufficient. Trust is anchored separately in
  // the configured producer key, before any source records are consumed.
  if (
    sourceCut?.format !== "sealed-bson-v1" ||
    !Buffer.isBuffer(sourceCut.manifest) ||
    !Buffer.isBuffer(sourceCut.signature)
  )
    throw new Error("A producer-sealed full BSON export is required");
  budget.serialized(sourceCut.manifest.length * 4 + sourceCut.signature.length);
  const manifest = BSON.deserialize(sourceCut.manifest);
  const key = context.trustedProducers?.[manifest.producer];
  if (!key || !verify(null, sourceCut.manifest, key, sourceCut.signature))
    throw new Error("Untrusted producer consistency proof");
  if (
    manifest.version !== "sealed-bson-v1" ||
    manifest.consistency !== "producer-sealed-full-export" ||
    manifest.complete !== true ||
    !manifest.sourceVersion ||
    !manifest.domain?.allSupportedHistory ||
    manifest.domain.records !== manifest.records
  )
    throw new Error("Incomplete or mutable source cut");
  if (!context.supportedDomainRevision || manifest.domain.revision !== context.supportedDomainRevision)
    throw new Error("Supported full-domain revision mismatch");
  if (
    !context.supportedHistory ||
    manifest.history?.start !== context.supportedHistory.start ||
    manifest.history?.end !== context.supportedHistory.end
  )
    throw new Error("Supported-history coverage mismatch");
  const start = new Date(manifest.history.start),
    end = new Date(manifest.history.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end < start ||
    start.getUTCHours() ||
    start.getUTCMinutes() ||
    start.getUTCSeconds() ||
    start.getUTCMilliseconds() ||
    end.getUTCHours() !== 23 ||
    end.getUTCMinutes() !== 59 ||
    end.getUTCSeconds() !== 59 ||
    end.getUTCMilliseconds() !== 999 ||
    !Number.isFinite(new Date(manifest.sourceCutAt).getTime())
  )
    throw new Error("Invalid source coverage or cut time");
  if (manifest.dataset !== "raw" && !(manifest.dataset === "summary-fixture" && context.allowSummaryFixtures === true))
    throw new Error("Mislabeled raw source cut");
  if (
    !manifest.collation ||
    typeof manifest.collation.locale !== "string" ||
    !Number.isSafeInteger(manifest.records) ||
    manifest.records < 0 ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 0 ||
    manifest.bytes > budget.limits.maxSourceBytes ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error("Invalid source inventory");
  const handle = await fs.open(sourceCut.filename, "r");
  let transport;
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.size !== BigInt(manifest.bytes)) throw new Error("Source transport integrity mismatch");
    const allocated = typeof stat.blocks === "bigint" && stat.blocks >= 0n ? Number(stat.blocks * 512n) : NaN;
    const allocatedBytes = Number.isSafeInteger(allocated) ? allocated : null;
    transport = {
      backing: createHash("sha256")
        .update(`${require("node:os").hostname()}:${stat.dev}:${stat.ino}`)
        .digest("hex"),
      logicalBytes: manifest.bytes,
      allocatedBytes,
      bytes: Math.max(manifest.bytes, allocatedBytes ?? 0),
      coverage:
        allocatedBytes === null ? "allocated-file-blocks-unavailable" : "allocated-file-blocks-not-volume-peaks",
    };
    // Verify the signed transport before extraction; verify again during stage
    // ingestion, so edits between the two passes cannot enter baseline ETL.
    const digest = createHash("sha256");
    let offset = 0;
    const length = Math.min(65536, Math.max(1, manifest.bytes));
    const lease = await budget.reserveSerialized(length);
    const buffer = Buffer.alloc(length);
    const release = lease.hold(buffer);
    try {
      budget.serialized(buffer.length);
      while (offset < manifest.bytes) {
        budget.check();
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, manifest.bytes - offset), offset);
        if (!bytesRead) throw new Error("Truncated source export");
        digest.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      if (digest.digest("hex") !== manifest.sha256) throw new Error("Source transport integrity mismatch");
    } finally {
      release();
      await lease.release();
    }
  } catch (error) {
    await handle.close();
    throw error;
  }
  return {
    manifest,
    transport,
    async *documents() {
      const digest = createHash("sha256");
      let offset = 0,
        count = 0;
      async function readExactly(buffer, position) {
        let cursor = 0;
        while (cursor < buffer.length) {
          budget.check();
          const { bytesRead } = await handle.read(buffer, cursor, buffer.length - cursor, position + cursor);
          if (!bytesRead) throw new Error("Truncated source export");
          cursor += bytesRead;
        }
      }
      const headerLease = await budget.reserveSerialized(8192);
      const header = Buffer.alloc(4);
      const releaseHeader = headerLease.hold(header);
      try {
        while (offset < manifest.bytes) {
          await readExactly(header, offset);
          const length = header.readInt32LE(0);
          if (length < 5 || offset + length > manifest.bytes) throw new Error("Invalid BSON source record");
          // Reserve the source record, decode/driver copies and one cursor batch.
          // An oversized record rejects the full candidate; it is never skipped.
          await budget.admitAdditional(length * 4 + 65536 + 4);
          budget.serialized(length * 4 + 65536 + 4);
          const lease = await budget.reserveSerialized(length);
          const buffer = Buffer.alloc(length);
          const release = lease.hold(buffer);
          try {
            header.copy(buffer);
            await readExactly(buffer.subarray(4), offset + 4);
            digest.update(buffer);
            offset += length;
            count += 1;
            yield BSON.deserialize(buffer, BSON_OPTIONS);
          } finally {
            release();
            await lease.release();
          }
        }
        if (count !== manifest.records || digest.digest("hex") !== manifest.sha256)
          throw new Error("Source changed during staging");
      } finally {
        releaseHeader();
        await headerLease.release();
      }
    },
    close: () => handle.close(),
  };
}

module.exports = { openSource };
