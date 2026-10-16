import { expect, it } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BSON } from "mongodb";
import { openFixture } from "./contract.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { ACTOR, digest } from "../../src/modules/patients/read-model/capacity.js";
import { policy } from "./capacity-fixture.cjs";
import { startApplication } from "./application.cjs";
import { fixtureRelease, descriptor, apiCapacity, page } from "./release-fixture.cjs";

it("blocks preparation and affected new reads when actual signed live capacity proof is unusable", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-live-proof-"));
  let app, config, subject, configFile;
  const records = { fault: "signature" };
  async function writeObservation() {
    const manifest = BSON.deserialize(config.evidence.manifest),
      key = config.trustedOperators[manifest.authority].publicKey;
    const policyKey = digest({ policy: manifest, operatorKey: key.export({ type: "spki", format: "der" }) });
    const packet = await config.observe({ policyKey });
    fs.writeFileSync(path.join(directory, "collector.bson"), packet.manifest);
    fs.writeFileSync(
      path.join(directory, "collector.sig"),
      records.fault === "signature" ? Buffer.alloc(64) : packet.signature
    );
  }
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    let actor;
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actual) => {
        actor = actual;
        return apiCapacity([cut], actual);
      },
      releaseFactory: async (actual) => {
        subject = actual;
        const base = BSON.deserialize(apiCapacity([cut], actor).evidence.manifest);
        config = {
          ...policy([cut], {
            processes: [
              { id: "builder", ...ACTOR, roles: ["builder", "api"] },
              { id: "api", ...actor, roles: ["api"] },
            ],
            overrides: {
              scope: "deployment",
              topology: { ...base.topology, database: { ...base.topology.database, name: fixture.db.databaseName } },
            },
            maximumLagMS: 300000,
            observationScope: "representative-complete-peaks",
            observations: {
              ram: {
                response: {
                  additional: 0,
                  unit: "bytes",
                  attribution: "isolated-response-additional-peak",
                  coverage: "complete-peak",
                  evidence: "signed-schema-stimulus-not-target-measurement",
                },
              },
            },
            observationTransform: (record) =>
              records.fault === "expired"
                ? { ...record, through: Date.now() - 600000 }
                : records.fault === "domains"
                  ? { ...record, domains: [] }
                  : records.fault === "metrics"
                    ? { ...record, domains: record.domains.map((domain) => ({ ...domain, cpu: undefined })) }
                    : records.fault === "overrun"
                      ? {
                          ...record,
                          domains: record.domains.map((domain) => ({
                            ...domain,
                            ram: { ...domain.ram, additional: 4 * 1024 ** 3, total: 4 * 1024 ** 3 },
                          })),
                        }
                      : record,
          }),
          processId: "api",
        };
        const release = fixtureRelease(subject, [descriptor(candidate)]);
        for (const [name, bytes] of Object.entries({
          "release.bson": release.evidence.manifest,
          "release.sig": release.evidence.signature,
          "capacity.bson": config.evidence.manifest,
          "capacity.sig": config.evidence.signature,
        }))
          fs.writeFileSync(path.join(directory, name), bytes);
        const keys = (entries) =>
          Object.fromEntries(
            Object.entries(entries).map(([id, value]) => [
              id,
              { ...value, publicKey: value.publicKey.export({ type: "spki", format: "pem" }) },
            ])
          );
        configFile = path.join(directory, "installed.json");
        fs.writeFileSync(
          configFile,
          JSON.stringify({
            policy: release.policy,
            evidence: { manifestFile: "release.bson", signatureFile: "release.sig" },
            capacity: {
              binding: config.binding,
              processId: "api",
              trustedOperators: keys(config.trustedOperators),
              trustedCollectors: keys(config.trustedCollectors),
              evidence: { manifestFile: "capacity.bson", signatureFile: "capacity.sig" },
              observation: { manifestFile: "collector.bson", signatureFile: "collector.sig" },
            },
          })
        );
        await writeObservation();
        return { configFile };
      },
    });
    expect(app.release.activation).toBe("blocked");
    for (const fault of ["signature", "expired", "domains", "metrics", "overrun"]) {
      records.fault = "valid";
      await writeObservation();
      const valid = await app.applyRelease({ mode: "read-model", release: { configFile } });
      expect(valid.activation).toBe("fixture-exercise");
      expect(valid.targetActivation).toBe("blocked");
      expect((await page(app)).map((result) => result.status)).toEqual(Array(6).fill(200));
      records.fault = fault;
      await writeObservation();
      expect(
        (await page(app)).map((result) => [result.status, result.body]),
        fault
      ).toEqual(Array.from({ length: 6 }, () => [503, { status: false, message: "Read model unavailable" }]));
      expect((await app.applyRelease({ mode: "read-model", release: { configFile } })).activation, fault).toBe(
        "blocked"
      );
    }
  } finally {
    await app?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    cut.close();
    await fixture.close();
  }
}, 90000);
