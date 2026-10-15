const { BSON } = require("mongodb");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HISTORY = Object.freeze({ start: "2024-01-01T00:00:00.000Z", end: "2024-01-02T23:59:59.999Z" });
const SECRET = "synthetic-raw-fixture-only";

function rawDocuments() {
  /** @type {Array<[number, string, string, string, string[]]>} */
  const definitions = [
    [1, "H1", "p1", "u1", ["E10", "I10"]],
    [1, "H1", "p1", "u2", ["E10"]],
    [1, "H2", "p1", "u3", ["E10"]],
    [2, "H2", "p2", "u4", ["E10"]],
    [2, "H1", "p3", "u5", ["J44"]],
    [2, "H1", "p4", "u6", ["C34"]],
    [2, "H1", "p5", "u7", ["F32"]],
    [2, "H1", "p6", "u8", ["I21"]],
    [2, "H1", "excluded", "u9", ["E10"]],
    [2, "H1", "unrelated", "u10", ["Z00"]],
  ];
  return definitions.map(([day, hcode, cid, transaction_uid, diagnoses], index) => ({
    _id: `finite-raw-${index}`,
    hcode,
    hname: `Synthetic ${hcode}`,
    area: hcode === "H1" ? "A" : 2,
    province: "P",
    district: hcode === "H1" ? "D1" : "D2",
    status: index === 8 ? "reclaimed" : "accepted",
    claim_date: new Date(`2024-01-0${day}T12:00:00.000Z`),
    cid,
    transaction_uid,
    diag_nosis: diagnoses.map((diag) => ({ diag })),
    total: String((index + 1) * 10),
  }));
}

// This producer owns the entire finite domain, seals the export only after all
// records have been emitted, and signs its consistency/completeness statement.
// These synthetic signatures are evidence for this fixture, never Production.
function sealFixture(
  documents = rawDocuments(),
  { dataset = "raw", collation = { locale: "simple" }, manifestOverrides = {} } = {}
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-raw-cut-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const filename = path.join(directory, "source.bson");
  const bytes = Buffer.concat(documents.map((document) => BSON.serialize(document)));
  fs.writeFileSync(filename, bytes, { mode: 0o400 });
  const manifest = {
    version: "sealed-bson-v1",
    producer: "synthetic-finite-domain-v1",
    consistency: "producer-sealed-full-export",
    sourceVersion: "finite-domain-v1",
    sourceCutAt: "2024-01-03T00:00:00.000Z",
    complete: true,
    dataset,
    history: HISTORY,
    collation,
    records: documents.length,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    domain: { revision: "finite-domain-v1", records: documents.length, allSupportedHistory: true },
    ...manifestOverrides,
  };
  const manifestBytes = BSON.serialize(manifest);
  const sourceCut = {
    format: "sealed-bson-v1",
    filename,
    manifest: manifestBytes,
    signature: sign(null, manifestBytes, privateKey),
  };
  return {
    sourceCut,
    comparisonContext: {
      comparisonOnly: true,
      trustedProducers: { "synthetic-finite-domain-v1": publicKey },
      supportedHistory: HISTORY,
      supportedDomainRevision: "finite-domain-v1",
      identitySecret: SECRET,
      allowSummaryFixtures: dataset === "summary-fixture",
    },
    close: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

const FIXTURE_BUDGET = Object.freeze({
  maxTimeMS: 30000,
  maxSourceBytes: 8 * 1048576,
  maxStorageBytes: 32 * 1048576,
  maxAdditionalRssBytes: 128 * 1048576,
  maxSerializedBytes: 8 * 1048576,
  maxChunkBytes: 1048576,
  maxPayloadBytes: 960 * 1024,
  maxHeavyOperations: 1,
});

module.exports = { rawDocuments, sealFixture, HISTORY, SECRET, FIXTURE_BUDGET };
