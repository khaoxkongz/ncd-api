const fs = require("node:fs");
const path = require("node:path");
const { createHash, createPublicKey, verify } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { BSON } = require("mongodb");
const { createBudget } = require("./budget");
const { createCapacity, ACTOR } = require("./capacity");
const { createControl } = require("./control");
const { scope, trackedDb, WORKER, within } = require("./lifetime");
const generations = require("./generation");

const TARGET_GATES = Object.freeze([
  "source",
  "correctness",
  "native",
  "capacity",
  "full-workload",
  "page",
  "freshness",
  "frontend",
  "operations",
]);
const authorities = new WeakMap();
const runtimes = new WeakMap();
const ROOT = path.resolve(__dirname, "../../../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => sha256(BSON.serialize({ value }));
const copy = (value) => BSON.deserialize(BSON.serialize({ value })).value;
const validDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function failure(reason) {
  const error = new Error("Release evidence unavailable");
  error.releaseReason = reason;
  throw error;
}

function report(reason = "release-evidence-missing") {
  return {
    mode: "read-model",
    activation: "blocked",
    targetActivation: "blocked",
    reason,
    gates: TARGET_GATES.map((name) => ({ name, state: "unverified" })),
  };
}

// Only local, bounded operator-installed files are accepted. Evidence contains
// no trust anchor and can never name a remote fetch or executable adapter.
function readFile(filename, maximum) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) failure("release-file-bound");
    const bytes = Buffer.allocUnsafeSlow(stat.size);
    if (fs.readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length || fs.fstatSync(fd).size !== stat.size)
      failure("release-file-changed");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function configuration(filename) {
  const installed = JSON.parse(readFile(filename, 65536).toString("utf8"));
  const local = (name) => {
    if (typeof name !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(name) || name === "." || name === "..")
      failure("release-file-name");
    return path.join(path.dirname(path.resolve(filename)), name);
  };
  const signed = (files, maximum) => ({
    manifest: readFile(local(files?.manifestFile), maximum),
    signature: readFile(local(files?.signatureFile), 64),
  });
  let capacity;
  if (installed.capacity) {
    const source = installed.capacity;
    capacity = {
      binding: source.binding,
      processId: source.processId,
      trustedOperators: source.trustedOperators,
      trustedCollectors: source.trustedCollectors,
      evidence: signed(source.evidence, 65536),
    };
    if (source.observation)
      capacity.observe = async ({ signal }) => {
        if (signal?.aborted) failure("release-collector-cancelled");
        // The collector owns timestamps and signatures. Reading an existing
        // observation does not refresh it or assert a new complete peak.
        return signed(source.observation, 65536);
      };
  }
  return {
    policy: installed.policy,
    capacity,
    evidence: () => signed(installed.evidence, 512 * 1024),
  };
}

function releaseSubject(db) {
  const files = [];
  let bytes = 0;
  function visit(directory) {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const content = readFile(filename, 1048576);
        bytes += content.length;
        if (files.length >= 256 || bytes > 4 * 1048576) failure("release-product-inventory-bound");
        files.push([path.relative(ROOT, filename).split(path.sep).join("/"), sha256(content)]);
      } else if (entry.isSymbolicLink()) failure("release-product-symlink");
    }
  }
  visit(path.join(ROOT, "src"));
  const options = db.client.options;
  return {
    database: db.databaseName,
    mongoConnectionSha256: sha256(
      JSON.stringify({
        hosts: options.hosts.map((host) => host.toString()).sort(),
        srvHost: options.srvHost ?? null,
        replicaSet: options.replicaSet ?? null,
        tls: options.tls ?? false,
        readPreference: options.readPreference?.mode ?? null,
        readConcern: options.readConcern?.level ?? null,
        writeConcern: options.writeConcern?.w ?? null,
        retryReads: options.retryReads,
        retryWrites: options.retryWrites,
      })
    ),
    actor: { pid: ACTOR.pid, startedAt: ACTOR.startedAt, hostSha256: sha256(ACTOR.host) },
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    driver: require("mongodb/package.json").version,
    codec: require("roaring/package.json").version,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    productSha256: sha256(JSON.stringify(files)),
    lockfileSha256: sha256(readFile(path.join(ROOT, "package-lock.json"), 1048576)),
  };
}

function applicable(record) {
  const { policy, evidenceSha256 } = record;
  if (policy.revocations.includes(evidenceSha256)) failure("release-revoked");
  const validity = policy.validity;
  if (validity?.inFlight !== "pinned-completion") failure("unsupported-release-inflight-rule");
  if (validity.kind === "revision" && validity.revision === policy.revision) return;
  if (
    validity.kind === "window" &&
    Number.isSafeInteger(validity.from) &&
    Number.isSafeInteger(validity.until) &&
    validity.from <= Date.now() &&
    Date.now() <= validity.until
  )
    return;
  failure("release-validity-unverified");
}

function checkEvidence(policy, evidence, subject) {
  if (
    !policy ||
    BSON.calculateObjectSize(policy) > 65536 ||
    policy.schema !== "patients-release-policy-v1" ||
    typeof policy.revision !== "string" ||
    policy.revision.length < 1 ||
    policy.revision.length > 128
  )
    failure("release-policy-missing");
  if (!["isolated-fixture", "deployment"].includes(policy.scope)) failure("release-scope-unverified");
  const fixture = /^patients_contract_[a-f0-9]{32}$/.test(subject.database);
  if ((policy.scope === "isolated-fixture") !== fixture) failure("release-scope-database-mismatch");
  if (!isDeepStrictEqual(policy.subject, subject)) failure("release-subject-mismatch");
  if (
    !Buffer.isBuffer(evidence?.manifest) ||
    evidence.manifest.length > 512 * 1024 ||
    !Buffer.isBuffer(evidence.signature) ||
    evidence.signature.length !== 64
  )
    failure("release-evidence-bound");
  const evidenceSha256 = sha256(evidence.manifest);
  if (
    !validDigest(policy.reviewedSha256) ||
    policy.reviewedSha256 !== evidenceSha256 ||
    !Array.isArray(policy.revocations) ||
    policy.revocations.length > 32 ||
    policy.revocations.some((value) => !validDigest(value))
  )
    failure("release-review-missing");
  const reviewer = policy.reviewer;
  if (
    !["release-exercise", "release-review"].includes(reviewer?.role) ||
    typeof reviewer.id !== "string" ||
    reviewer.id.length > 128 ||
    typeof reviewer.publicKey !== "string" ||
    reviewer.publicKey.length > 4096
  )
    failure("release-authority-missing");
  const key = createPublicKey(reviewer.publicKey);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, evidence.manifest, key, evidence.signature))
    failure("release-signature-invalid");
  const manifest = BSON.deserialize(evidence.manifest);
  const observations = manifest.schema === "patients-release-evidence-v1";
  const keys = observations
    ? ["schema", "scope", "purpose", "origin", "reviewer", "subject", "descriptors", "deployment", "gates"].sort()
    : ["schema", "scope", "purpose", "reviewer", "subject", "descriptors", "targetGates"].sort();
  if (
    !isDeepStrictEqual(Object.keys(manifest).sort(), keys) ||
    manifest.scope !== policy.scope ||
    manifest.reviewer !== reviewer.id ||
    !isDeepStrictEqual(manifest.subject, subject)
  )
    failure("unsupported-release-artifact");
  if (observations) {
    if (
      reviewer.role !== "release-review" ||
      reviewer.scope !== policy.scope ||
      !Array.isArray(reviewer.deployments) ||
      !reviewer.deployments.includes(manifest.deployment?.id) ||
      !Array.isArray(reviewer.gates) ||
      !TARGET_GATES.every((name) => reviewer.gates.includes(name)) ||
      manifest.purpose !== "six-controller-release" ||
      manifest.origin !== (fixture ? "synthetic-protocol-stimulus" : "operator-observations") ||
      manifest.descriptors?.length !== 1
    )
      failure("release-review-scope");
  } else if (
    policy.scope !== "isolated-fixture" ||
    reviewer.role !== "release-exercise" ||
    manifest.schema !== "patients-release-exercise-v1" ||
    manifest.purpose !== "six-controller-release-protocol" ||
    !isDeepStrictEqual(manifest.targetGates, Object.fromEntries(TARGET_GATES.map((name) => [name, "unverified"])))
  )
    failure("unsupported-release-artifact");
  if (
    !Array.isArray(manifest.descriptors) ||
    !manifest.descriptors.length ||
    manifest.descriptors.length > 2 ||
    new Set(manifest.descriptors.map((item) => item.generationId)).size !== manifest.descriptors.length
  )
    failure("release-descriptor-bound");
  for (const item of manifest.descriptors) {
    if (
      !isDeepStrictEqual(
        Object.keys(item).sort(),
        ["generationId", "seal", "publications", "source", "versions"].sort()
      ) ||
      !/^[a-f0-9-]{36}$/.test(item.generationId) ||
      !validDigest(item.seal) ||
      !Array.isArray(item.publications) ||
      !item.publications.length ||
      item.publications.length > 2 ||
      new Set(item.publications).size !== item.publications.length ||
      item.publications.some(
        (value) => typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) >= 2n ** 63n
      )
    )
      failure("release-publication-binding");
  }
  const record = {
    policy: copy(policy),
    evidenceSha256,
    descriptors: copy(manifest.descriptors),
    manifest: copy(manifest),
    observations,
  };
  applicable(record);
  return record;
}

function nativeCheck(budget) {
  const { RoaringBitmap32 } = require("./bitmap").codec();
  const golden = Buffer.from("3a300000020000000000010001000000180000001c000000000001000000", "hex");
  const encoded = budget.bitmap(() => new RoaringBitmap32([0, 1, 65536]), 3);
  let decoded;
  try {
    decoded = budget.bitmap(() => RoaringBitmap32.deserialize(golden, "portable"), 3);
    if (!encoded.serialize("portable").equals(golden) || !isDeepStrictEqual([...decoded], [0, 1, 65536]))
      failure("release-native-golden");
  } finally {
    encoded.dispose();
    decoded?.dispose();
  }
}

async function prepareRelease({ db, capacity, policy, evidence, configFile } = {}) {
  let result = report();
  try {
    if (!db) failure("release-database-missing");
    if (!configFile && (!policy || !evidence)) failure("release-policy-missing");
    let installed;
    if (configFile) {
      installed = configuration(configFile);
      policy = installed.policy;
      capacity = installed.capacity ?? capacity;
    }
    const budget = createBudget({ maxTimeMS: 60000 }, { request: true });
    let record;
    const operation = (async () => {
      const resources = createCapacity({ db, config: capacity });
      const control = createControl({ db });
      let owner;
      try {
        owner = await resources.begin(budget, "api", {
          worker: WORKER,
          generationId: "release-preparation",
          managed: true,
        });
      } catch (error) {
        budget.settlement = createBudget({ maxTimeMS: 60000 }, { request: true });
        await budget.capacity?.finish({
          safe: error.controlOutcome !== "unknown",
          proof: "release-admission-before-model-dispatch",
        });
        throw error;
      }
      const work = scope({ db, budget });
      const execution = work.task(async () => {
        await budget.admitMemory(16 * 1048576);
        const metadata = await budget.reserveSerialized(2 * 1048576);
        try {
          if (installed) evidence = installed.evidence();
          const subject = releaseSubject(db);
          result.subject = subject;
          record = checkEvidence(policy, evidence, subject);
          if (record.policy.scope === "deployment" && typeof capacity?.observe !== "function")
            failure("release-live-capacity-observer-missing");
          metadata.hold(evidence.manifest);
          budget.hold(record, "decoded", BSON.calculateObjectSize(record) * 4);
          nativeCheck(budget);
          let checked;
          if (record.observations) {
            if (!capacity?.evidence?.manifest) failure("release-capacity-policy-missing");
            const mongo = await trackedDb(db).command({ buildInfo: 1 });
            const hello = await trackedDb(db).command({ hello: 1 });
            checked = require("./release-evidence").verifyObservations(record.manifest, record.policy, {
              capacityPolicy: BSON.deserialize(capacity.evidence.manifest),
              capacityKey: owner.identity().policyKey,
              mongo,
              topology: {
                replicaSet: hello.setName ?? null,
                router: hello.msg ?? null,
                members: hello.hosts?.length ?? 1,
              },
            });
          }
          const state = await control.read(budget);
          for (const item of record.descriptors) {
            const slot = state.slots.find((slot) => slot.generationId === item.generationId);
            if (!slot?.settled || !["active", "retired", "ready"].includes(slot.state) || slot.seal !== item.seal)
              failure("release-generation-not-retained");
            const generation = await generations.verify(trackedDb(db), item, budget, { contents: true });
            if (
              digest(generation.source) !== digest(item.source) ||
              digest(generation.versions) !== digest(item.versions)
            )
              failure("release-descriptor-subject-mismatch");
            if (record.observations) {
              const fixed = record.manifest.gates.capacity.observations.fixedBudgets;
              const declared = generation.resources?.declared;
              for (const [name, field] of Object.entries({
                builderBytes: "maxAdditionalRssBytes",
                serializedBytes: "maxSerializedBytes",
                chunkBytes: "maxChunkBytes",
                payloadBytes: "maxPayloadBytes",
              }))
                if (!Number.isSafeInteger(declared?.[field]) || fixed[name] > declared[field])
                  failure("release-original-budget-enlarged");
            }
            resources.source(generation.source);
          }
          return checked;
        } finally {
          await metadata.release();
        }
      });
      const finalized = execution.finally(async () => {
        const proof = await work.drain();
        budget.settlement = createBudget({ maxTimeMS: 60000 }, { request: true });
        const settled = await owner.finish(proof);
        if (!settled.safe) failure("release-preparation-unsettled");
      });
      return finalized;
    })();
    void operation.catch(() => {});
    const checked = await within(operation, budget);
    applicable(record);
    // Keep only the small exact authorization after review, not all page,
    // capacity and reference observations in every installed runtime.
    const approved = { policy: record.policy, evidenceSha256: record.evidenceSha256, descriptors: record.descriptors };
    const authorization = Object.freeze({});
    authorities.set(authorization, approved);
    const reader = require("./reader").createReader({ db, capacity, authorization });
    const fixture = record.policy.scope === "isolated-fixture";
    result = {
      ...result,
      activation: fixture ? "fixture-exercise" : "read-model",
      targetActivation: fixture ? "blocked" : "authorized-exact-subjects",
      reason: fixture ? "fixture-protocol-only" : "reviewed-observations-verified",
      evidenceSha256: record.evidenceSha256,
      policyRevision: record.policy.revision,
      ...checked,
      descriptors: copy(
        record.descriptors.map(({ generationId, seal, publications }) => ({ generationId, seal, publications }))
      ),
    };
    const runtime = Object.freeze({ mode: "read-model", reader });
    runtimes.set(runtime, authorization);
    return { report: result, runtime };
  } catch (error) {
    return { report: { ...result, reason: error.releaseReason ?? "release-verification-failed" } };
  }
}

function authorizeRelease(authorization, pin, generation) {
  const record = authorities.get(authorization);
  if (!record || !pin?.descriptorSeal || !pin.publicationVersion) failure("release-authority-missing");
  applicable(record);
  const permitted = record.descriptors.find(
    (item) =>
      item.generationId === pin.generationId &&
      item.seal === pin.descriptorSeal &&
      item.publications.includes(pin.publicationVersion)
  );
  if (!permitted) failure("release-selected-identity-unapproved");
  if (
    generation &&
    (generation.seal !== permitted.seal ||
      digest(generation.source) !== digest(permitted.source) ||
      digest(generation.versions) !== digest(permitted.versions))
  )
    failure("release-selected-descriptor-mismatch");
}

function authorizePublication(runtime, generationId, publicationVersion) {
  const authorization = runtimes.get(runtime);
  const record = authorities.get(authorization);
  const descriptor = record?.descriptors.find((item) => item.generationId === generationId);
  authorizeRelease(authorization, { generationId, publicationVersion, descriptorSeal: descriptor?.seal });
}

module.exports = { prepareRelease, authorizeRelease, authorizePublication, releaseSubject };
