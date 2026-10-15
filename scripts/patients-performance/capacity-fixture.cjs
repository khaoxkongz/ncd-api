const { generateKeyPairSync, sign } = require("node:crypto");
const { BSON } = require("mongodb");
const { ACTOR } = require("../../src/modules/patients/read-model/capacity");

// A fixture operator, separate from the finite-source producer. Its keys are
// installed by the fixture's composition root; the evidence carries no key.
function policy(
  cuts,
  { processes = [{ id: "builder", ...ACTOR, roles: ["builder", "api"] }], overrides = {}, observations } = {}
) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unit = (allocation, existingPeak = 0, reservations = 0) => ({
    allocation,
    existingPeak,
    reservations,
    totalLimit: allocation,
  });
  const deployment = {
    id: "isolated-capacity-fixture",
    revision: "capacity-fixture-v1",
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    driver: "6.10.0",
    codec: "2.7.0",
  };
  const manifest = {
    version: "patients-capacity-v1",
    authority: "finite-fixture-operator",
    scope: "isolated-fixture",
    deployment,
    validity: { kind: "revision", revision: deployment.revision },
    evidence: {
      reference: "finite-synthetic-policy-only",
      sha256: "0".repeat(64),
      from: "2024-01-01T00:00:00.000Z",
      through: "2024-01-02T00:00:00.000Z",
    },
    topology: {
      processes: processes.map((item) => ({ ...item, domains: ["fixture-host"] })),
      database: { id: "fixture-mongo", domains: ["fixture-host"] },
      volumes: [
        { id: "fixture-volume", purposes: ["source", "database", "logs", "temporary"], domains: ["fixture-host"] },
      ],
    },
    workloads: cuts.map(({ sourceCut }) => {
      const source = BSON.deserialize(sourceCut.manifest);
      return {
        sha256: source.sha256,
        sourceVersion: source.sourceVersion,
        domain: source.domain.revision,
        history: source.history,
      };
    }),
    domains: [
      {
        id: "fixture-host",
        kind: "host",
        ram: unit(4 * 1024 ** 3),
        disk: unit(1024 ** 3),
        cpu: { ...unit(8), unit: "cores", windowMS: 1000 },
        io: [{ id: "write", ...unit(1000000), unit: "bytes/s", windowMS: 1000 }],
      },
    ],
    ...overrides,
  };
  const observer = observations ? generateKeyPairSync("ed25519") : null;
  if (observer)
    manifest.observers = [
      {
        authority: "finite-fixture-collector",
        mechanism: "signed-synthetic-guard-stimulus",
        maximumLagMS: 1000,
        maximumGapMS: 0,
      },
    ];
  const bytes = BSON.serialize(manifest);
  const result = {
    evidence: { manifest: bytes, signature: sign(null, bytes, privateKey) },
    trustedOperators: {
      "finite-fixture-operator": { publicKey, scope: "isolated-fixture", deployments: [deployment.id] },
    },
    binding: deployment,
    processId: processes.find((item) => item.pid === process.pid)?.id ?? processes[0].id,
    // No fabricated measurements. Actual collectors are used where available;
    // full host/DB/transient peaks are absent and fail fixture acceptance.
  };
  if (observer) {
    result.trustedCollectors = {
      "finite-fixture-collector": { publicKey: observer.publicKey, scope: "isolated-fixture" },
    };
    result.observe = async ({ policyKey }) => {
      const values = Object.fromEntries(
        ["ram", "disk", "cpu", "io:write"].map((metric) => [
          metric,
          {
            additional: 0,
            total: 0,
            api: 0,
            builder: 0,
            database: 0,
            unit: metric === "cpu" ? "cores" : metric === "io:write" ? "bytes/s" : "bytes",
            windowMS: ["cpu", "io:write"].includes(metric) ? 1000 : null,
            coverage: "complete-peak",
            evidence: "synthetic-guard-input-not-measured-target-peaks",
            ...observations[metric],
          },
        ])
      );
      const record = BSON.serialize({
        authority: "finite-fixture-collector",
        mechanism: "signed-synthetic-guard-stimulus",
        policyKey,
        scope: "synthetic-stimulus",
        from: ACTOR.startedAt,
        through: Date.now(),
        maximumGapMS: 0,
        domains: [{ id: "fixture-host", ...values }],
      });
      return { manifest: record, signature: sign(null, record, observer.privateKey) };
    };
  }
  return result;
}

module.exports = { policy };
