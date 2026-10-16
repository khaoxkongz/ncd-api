const { BSON } = require("mongodb");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { policy } = require("./capacity-fixture.cjs");
const { ACTOR } = require("../../src/modules/patients/read-model/capacity");
const { SNAPSHOT_REQUEST } = require("./snapshot-fixture.cjs");
const { deploymentEvidence } = require("./release-evidence-fixture.cjs");

const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
const TARGET_GATES = [
  "source",
  "correctness",
  "native",
  "capacity",
  "full-workload",
  "page",
  "freshness",
  "frontend",
  "operations",
];

function fixtureRelease(subject, descriptors, { change = (value) => value, policyChange = (value) => value } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = BSON.serialize(
    change({
      schema: "patients-release-exercise-v1",
      scope: "isolated-fixture",
      purpose: "six-controller-release-protocol",
      reviewer: "fixture-release-reviewer",
      subject,
      descriptors,
      targetGates: Object.fromEntries(TARGET_GATES.map((name) => [name, "unverified"])),
    })
  );
  return {
    policy: policyChange({
      schema: "patients-release-policy-v1",
      revision: "fixture-reviewed-release-v1",
      scope: "isolated-fixture",
      subject,
      reviewer: {
        id: "fixture-release-reviewer",
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        role: "release-exercise",
      },
      reviewedSha256: createHash("sha256").update(manifest).digest("hex"),
      validity: { kind: "revision", revision: "fixture-reviewed-release-v1", inFlight: "pinned-completion" },
      revocations: [],
    }),
    evidence: { manifest, signature: sign(null, manifest, privateKey) },
  };
}

function descriptor(candidate, publications = ["1"]) {
  return {
    generationId: candidate.generationId,
    seal: candidate.seal,
    publications,
    source: candidate.source,
    versions: candidate.versions,
  };
}

function reviewedEvidence(subject, descriptors, config, mutate = (value) => value) {
  const draft = mutate(deploymentEvidence(subject, descriptors, config));
  return fixtureRelease(subject, descriptors, {
    change: () => draft,
    policyChange: (policy) => ({
      ...policy,
      deployment: draft.deployment,
      reviewer: {
        ...policy.reviewer,
        role: "release-review",
        scope: "isolated-fixture",
        deployments: [draft.deployment.id],
        gates: TARGET_GATES,
      },
    }),
  });
}

async function page(app, request = SNAPSHOT_REQUEST) {
  return Promise.all(
    ROUTES.map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ncd-backend": "legacy" },
        body: JSON.stringify({ ...request, backendMode: "legacy" }),
      });
      return {
        status: response.status,
        body: await response.json(),
        source: response.headers.get("x-ncd-source-cut"),
        state: response.headers.get("x-ncd-data-state"),
      };
    })
  );
}

function apiCapacity(cuts, actor) {
  return {
    ...policy(cuts, {
      processes: [
        { id: "builder", ...ACTOR, roles: ["builder", "api"] },
        { id: "api", ...actor, roles: ["api"] },
      ],
    }),
    processId: "api",
  };
}

module.exports = { fixtureRelease, descriptor, reviewedEvidence, page, apiCapacity, TARGET_GATES };
