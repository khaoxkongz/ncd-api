const fs = require("node:fs");
const path = require("node:path");
const { openLoadFixture } = require("./load-fixture.cjs");
const { runLoads } = require("./loads.cjs");

async function main() {
  const [phase, flag, output] = process.argv.slice(2);
  if (!["explore", "acceptance"].includes(phase) || flag !== "--output" || !output || process.argv.length !== 5)
    throw new Error("Usage: report-loads.cjs explore|acceptance --output <new-local-directory>");
  const outputDirectory = path.resolve(output);
  if (fs.existsSync(outputDirectory))
    throw new Error("Output directory must be new so prior attempts cannot be overwritten");
  const fixture = await openLoadFixture(phase);
  let report;
  try {
    report = await runLoads(fixture.plan, { openApplication: fixture.openApplication, outputDirectory });
    process.stdout.write(
      `${JSON.stringify({ schema: report.schema, phase, outputDirectory, conditions: report.conditions.map(({ id, attempted, requiredAttempts, apiProtocolPassed, failure, summary }) => ({ id, attempted, requiredAttempts, apiProtocolPassed, failure, p95Ms: summary.p95Ms })), completion: report.completion, releaseGates: report.releaseGates })}\n`
    );
  } finally {
    const cleanup = await fixture.close({ safe: report?.completion === "local-api-protocol-recorded" });
    if (!cleanup.removed) {
      // Private cleanup coordinates are outside the report; no unknown model
      // ownership is reclaimed from process disappearance or quiet telemetry.
      fs.writeFileSync(`${outputDirectory}.retained-fixture.json`, `${JSON.stringify(cleanup)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    }
  }
}
if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
module.exports = { main };
