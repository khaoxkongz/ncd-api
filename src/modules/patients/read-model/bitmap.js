const { createHash } = require("node:crypto");
const { BSON, Long, Binary } = require("mongodb");
const { BLOCK_SIZE, VERSIONS } = require("./schema");

function codec() {
  // Required only by explicit build/candidate reads, never by legacy startup.
  const installed = require("roaring/package.json");
  if (installed.version !== "2.7.0") throw new Error("Incompatible native bitmap codec");
  return require("roaring");
}

function ordinalParts(ordinal) {
  const value = Long.isLong(ordinal) ? ordinal.toBigInt() : ordinal;
  if (typeof value !== "bigint" || value < 0n || value >= 2n ** 63n)
    throw new Error("Invalid Int64 dictionary ordinal");
  return { block: Long.fromBigInt(value / BLOCK_SIZE), offset: Number(value % BLOCK_SIZE) };
}

function directoryToken(document) {
  return BSON.serialize({
    generationId: document.generationId,
    setId: document.setId,
    category: document.category,
    block: document.block,
    chunkNo: document.chunkNo,
    start: document.start,
    end: document.end,
    popcount: document.popcount,
    length: document.length,
    checksum: document.checksum,
    versions: document.versions,
  });
}

async function writeChunks({ edges, chunks, directory, daily, generationId, budget }) {
  const native = codec();
  const maxContainers = Math.min(119, Math.floor((budget.limits.maxPayloadBytes - 128) / 8208));
  if (maxContainers < 1) throw new Error("Payload budget cannot hold one complete Roaring container");
  const cursor = edges
    .find({ generationId }, budget.options({ promoteLongs: false }))
    .sort({ setId: 1, category: 1, block: 1, offset: 1 });
  let bitmap = budget.bitmap(() => new native.RoaringBitmap32());
  let current,
    startContainer,
    chunkNo = 0,
    count = 0,
    members = 0,
    digest;
  async function flushChunk() {
    if (!bitmap.size) return;
    const encodedLength = bitmap.getSerializationSizeInBytes("portable");
    await budget.admitAdditional(encodedLength * 4 + 65536);
    const lease = await budget.reserveSerialized(encodedLength);
    const payload = bitmap.serialize("portable");
    const release = lease.hold(payload);
    try {
      budget.serialized(payload.length * 4 + 65536);
      const document = {
        generationId,
        setId: current.setId,
        category: current.category,
        block: current.block,
        chunkNo: chunkNo++,
        start: startContainer * 65536,
        end: Math.min(Number(BLOCK_SIZE), (startContainer + maxContainers) * 65536),
        popcount: bitmap.size,
        length: payload.length,
        checksum: createHash("sha256").update(payload).digest("hex"),
        versions: VERSIONS,
        payload: new Binary(payload),
      };
      if (
        payload.length > budget.limits.maxPayloadBytes ||
        BSON.serialize(document).length > budget.limits.maxChunkBytes
      )
        throw new Error("Chunk BSON budget exceeded");
      digest.update(directoryToken(document));
      members += bitmap.size;
      count += 1;
      await chunks.insertOne(document);
      await directory.insertOne(BSON.deserialize(directoryToken(document), { promoteLongs: false }));
      bitmap.dispose();
      bitmap = budget.bitmap(() => new native.RoaringBitmap32());
    } finally {
      release();
      await lease.release();
    }
  }
  async function finishSet() {
    if (!current) return;
    await flushChunk();
    await daily.updateOne(
      { generationId, rowId: current.setId },
      {
        $set: {
          [`members.${current.category}.chunks`]: count,
          [`members.${current.category}.cardinality`]: members,
          [`members.${current.category}.directorySha256`]: digest.digest("hex"),
        },
      }
    );
  }
  try {
    for await (const edge of cursor) {
      budget.native(native.getRoaringUsedMemory());
      const differentSet = !current || current.setId !== edge.setId || current.category !== edge.category;
      if (differentSet) {
        await finishSet();
        count = 0;
        members = 0;
        chunkNo = 0;
        digest = createHash("sha256");
      }
      const container = Math.floor(edge.offset / 65536);
      if (differentSet || !current.block.equals(edge.block) || container >= startContainer + maxContainers) {
        if (!differentSet) await flushChunk();
        current = edge;
        startContainer = container;
      }
      bitmap.add(edge.offset);
    }
    await finishSet();
  } finally {
    await cursor.close();
    bitmap.dispose();
  }
}

function decodeChunk(document, budget) {
  const native = codec();
  const payload =
    document.payload instanceof Binary
      ? document.payload.buffer.subarray(0, document.payload.position)
      : document.payload;
  budget.serialized(payload.length * 4 + 65536);
  if (
    !Buffer.isBuffer(payload) ||
    payload.length !== document.length ||
    payload.length > budget.limits.maxPayloadBytes ||
    BSON.serialize(document).length > budget.limits.maxChunkBytes ||
    createHash("sha256").update(payload).digest("hex") !== document.checksum ||
    !document.versions ||
    Object.keys(document.versions).length !== Object.keys(VERSIONS).length ||
    !Object.entries(VERSIONS).every(([key, value]) => document.versions[key] === value) ||
    !Long.isLong(document.block) ||
    document.block.isNegative() ||
    document.block.toBigInt() >= 2n ** 37n ||
    !Number.isInteger(document.start) ||
    !Number.isInteger(document.end) ||
    document.start < 0 ||
    document.end > Number(BLOCK_SIZE) ||
    document.start % 65536 ||
    document.end % 65536 ||
    document.end <= document.start
  )
    throw new Error("Corrupt bitmap chunk");
  const bitmap = budget.bitmap(() => native.RoaringBitmap32.deserialize(payload, "portable"), document.popcount);
  if (bitmap.size !== document.popcount || bitmap.minimum() < document.start || bitmap.maximum() >= document.end) {
    bitmap.dispose();
    throw new Error("Corrupt bitmap interval or count");
  }
  budget.native(native.getRoaringUsedMemory());
  return bitmap;
}

module.exports = { codec, ordinalParts, directoryToken, writeChunks, decodeChunk };
