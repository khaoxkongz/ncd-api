const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { openFixture } = require("./contract.cjs");
const { createBuilder } = require("../../src/modules/patients/read-model/builder");
const { sealSnapshotFixture, SNAPSHOT_CLOCK, SNAPSHOT_REQUEST } = require("./snapshot-fixture.cjs");
const { FIXTURE_BUDGET } = require("./raw-fixture.cjs");
const { startApplication } = require("./application.cjs");
const { fixtureRelease, descriptor, apiCapacity, page, TARGET_GATES } = require("./release-fixture.cjs");

async function main() {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  let app;
  const reportAllowance = 256 * 1024;
  try {
    const budget = { ...FIXTURE_BUDGET, maxStorageBytes: FIXTURE_BUDGET.maxStorageBytes - reportAllowance };
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, budget, { ...cut.comparisonContext, comparisonOnly: false });
    const active = await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      clock: SNAPSHOT_CLOCK,
      backendMode: "read-model",
      capacityFactory: (actor) => apiCapacity([cut], actor),
      releaseFactory: (subject) => fixtureRelease(subject, [descriptor(candidate)]),
    });
    const prepared = app.release;
    const snapshot = await app.captureLoad({ bodyBytes: JSON.stringify(SNAPSHOT_REQUEST) });
    const live = await app.captureLoad({
      bodyBytes: JSON.stringify({ startDate: "2024-01-07", endDate: "2024-01-09" }),
    });
    for (const load of [snapshot, live]) {
      assert.equal(load.settlement.safe, true);
      assert.equal(load.errorEvidenceVerified, true);
      assert.deepEqual(
        load.responses.map((response) => response.status),
        Array(6).fill(200)
      );
      assert.equal(load.responses[0].body.result[0].patient_count, 6);
      assert(
        load.responses.every(
          (response) =>
            response.headers["x-ncd-source-cut"] === SNAPSHOT_CLOCK &&
            response.headers["x-ncd-data-state"] === "fresh" &&
            response.headers["cache-control"] === "no-store"
        )
      );
    }
    const rejectedEvidence = fixtureRelease(prepared.subject, [descriptor(candidate)]);
    rejectedEvidence.policy.reviewedSha256 = "f".repeat(64);
    const rejected = await app.applyRelease({ mode: "read-model", release: rejectedEvidence });
    const unavailable = await app.captureLoad({ bodyBytes: JSON.stringify(SNAPSHOT_REQUEST) });
    assert.equal(unavailable.settlement.safe, true);
    assert.deepEqual(
      unavailable.responses.map((response) => [response.status, response.body]),
      Array.from({ length: 6 }, () => [503, { status: false, message: "Read model unavailable" }])
    );
    assert.equal(unavailable.telemetry.commandsStarted, 0);
    const legacyReport = await app.rollbackRelease({ target: "legacy" });
    const legacy = await page(app, { startDate: "2024-01-07", endDate: "2024-01-08" });
    assert(
      legacy.every((response) => response.status === 200 && response.source === null && response.state === "unknown")
    );
    const closed = await app.close();
    assert.equal(closed.graceful, true);
    assert.equal(closed.dependencySettlement, "no-unresolved-observed-load");
    app = undefined;
    const control = await fixture.db.collection("patients_model_control").findOne({ _id: "patients" });
    assert.equal(control.pins.length, 0);
    assert.equal(control.capacity.owners.length, 0);
    const output = {
      schema: "patients-release-fixture-report-v1",
      scope: "isolated-fixture",
      purpose: "backend-startup-selection-and-rollback-only",
      source: {
        sha256: candidate.source.sha256,
        records: candidate.source.records,
        history: candidate.source.history,
        domain: candidate.source.domain,
      },
      active,
      seal: candidate.seal,
      versions: candidate.versions,
      runtime: prepared.subject,
      execution: {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
        files: Object.fromEntries(
          execFileSync(
            "git",
            [
              "ls-files",
              "--cached",
              "--others",
              "--exclude-standard",
              "-z",
              "src",
              "scripts/patients-performance",
              "package.json",
              "package-lock.json",
              "vite.config.ts",
            ],
            { encoding: "utf8" }
          )
            .split("\0")
            .filter((filename) => filename && /\.(js|cjs|json|ts)$/.test(filename))
            .sort()
            .map((filename) => [filename, createHash("sha256").update(fs.readFileSync(filename)).digest("hex")])
        ),
      },
      fixedBudget: budget,
      fixedReportAllowanceBytes: reportAllowance,
      prepared,
      snapshot,
      live,
      rejected,
      unavailable,
      legacyReport,
      legacy,
      closed,
      finalOwnership: {
        pins: control.pins.length,
        capacityOwners: control.capacity.owners.length,
        occupiedSlots: control.slots.filter((slot) => slot.state !== "free").length,
      },
      releaseGates: TARGET_GATES.map((name) => ({ name, state: "unverified" })),
      targetActivation: "blocked",
      limitations: [
        "Synthetic source and fixture-only reviewer; not target authority",
        "No real frontend, page or visible freshness measurement",
        "Representative source/history/workload/headroom/native/topology/target release inputs remain absent",
        "This is not a 20/100 timing or Production acceptance run",
      ],
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    assert(Buffer.byteLength(json) <= reportAllowance);
    await fixture.close();
    cut.close();
    process.stdout.write(json);
  } catch (error) {
    // An uncertain failure never drops the model/source because a child exited.
    const retained = path.join(os.tmpdir(), `patients-release-retained-${randomUUID()}.json`);
    fs.writeFileSync(
      retained,
      JSON.stringify({ database: fixture.db.databaseName, sourceFilename: cut.sourceCut.filename, error: error.name }),
      { mode: 0o600 }
    );
    process.stderr.write(`Release fixture failed; private retention record ${retained}\n`);
    await app?.close();
    await fixture.client.close();
    throw error;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.name}\n`);
  process.exitCode = 1;
});
