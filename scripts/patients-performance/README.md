# Patients Atlas baseline

This tool records the accepted synthetic workload and responses from the five baseline Patients controllers.
It measures combined API time, endpoint time, server time, and aggregation time.
It does not establish UAT latency or Patients page acceptance.

The canonical requirements are these accepted resolutions:

- [Response comparison](https://github.com/khaoxkongz/ncd-api/issues/4#issuecomment-6130369446)
- [Atlas limits and isolation](https://github.com/khaoxkongz/ncd-api/issues/5#issuecomment-6131049408)
- [Synthetic workload](https://github.com/khaoxkongz/ncd-api/issues/6#issuecomment-6138189173)

## Run again

From the repository root, install dependencies with `vp install`. Keep the existing ignored `.env` file.
The test process reads its Atlas connection, selects `ncds_perf_synthetic` explicitly, and leaves `.env` unchanged.

Run the complete first profile with one command:

```sh
vp exec node scripts/patients-performance/run.cjs
```

The default output directory is `docs/wayfinder/patients-performance/results/atlas-1000`.
The command replaces documents only in the two manifest-listed synthetic collections.
It refuses unexpected collections or documents with another profile identity.
It retains the baseline indexes and restores the normal profile after controlled empty-data comparisons.

Other commands:

```sh
# Generate and verify the profile locally, without connecting to Atlas.
vp exec node scripts/patients-performance/run.cjs --command generate

# Inspect the explicit synthetic database and shared storage, without writes.
vp exec node scripts/patients-performance/run.cjs --command inspect

# Remove only this run's synthetic documents. Keep the collections and indexes.
vp exec node scripts/patients-performance/run.cjs --command cleanup

# Validate the tools.
vp check scripts/patients-performance
vp test
```

Cleanup reads `manifest.json` from the selected output directory.
It verifies the exact database name, collection allowlist, and document ownership before `deleteMany({})`.
It refuses documents from another profile.
For a different output directory, pass `--output <directory>` to both run and cleanup.

The generator supports `--count 2000`, `5000`, and `10000`, with `--pool fixed` or `scaled`.
Remove the previous profile before loading another profile.
Each load applies the storage gates again.
Dry generation does not establish that a growth profile fits aggregation memory or storage limits.
The recorded session measured only the 1,000-document profile.

## What the run records

The generator uses seed `20261013` and Mulberry32.
Its manifest records actual array histograms, memberships, observed distinct CIDs, reuse checks, geography, and BSON sizes.
Stored documents have deterministic IDs and a profile ownership field.
The loader compares stored BSON with generated BSON and records the actual indexes and collection counts.

The HTTP harness mounts the existing five controllers at their existing route paths.
It injects the explicit database without starting migration or Discord services.
No product source changes are necessary.
The report records product file hashes and tool hashes.

Each comparison captures the baseline twice under the same data, request, calculation clock, and time zone.
Comparison ignores only object key order.
Status, field presence, value types, numbers, arrays, labels, and series order must match exactly.
These captures supply references for a later candidate. This run has no candidate implementation.

The matrix covers 97 cases across all 14 accepted families.
It includes omitted and typed filters, boundary clocks in Bangkok and UTC, fixed arithmetic cases, and controlled failures.
Each negative case identifies the endpoints that can have an expected error.
Errors in the other endpoints still fail the comparison.

Each request trace records aggregation count, duration, namespace, pipeline fingerprint, and query errors.
The trace also retains errors suppressed by the baseline services.
A response with HTTP 200 and zero values cannot establish success after a failed query.
Explain operations run separately after timing.

## Timing conditions

The normal calculation clock is `2026-10-13T05:00:00.000Z` with `TZ=Asia/Bangkok`.
Only calculation code sees the pinned clock. Driver deadlines and elapsed timers remain real.

The measured scenarios are national live queries over the longest range and national stored snapshots.
Only one load is active at a time, with its five requests dispatched in parallel.

| Scenario               | Warmup loads | Measured attempts |
| ---------------------- | -----------: | ----------------: |
| First live requests    |            0 |                20 |
| Later live requests    |            5 |                20 |
| Later stored snapshots |            5 |                20 |

The first live trials precede reference capture and same-request warmup.
Their traces must show live summary queries for all five parts.
MongoDB internal cache state is uncontrolled.
Stored snapshots cannot satisfy the first-request condition that excludes an application cache result.

Endpoint timers stop when the complete JSON body has been parsed.
Combined time stops when all five bodies have been parsed.
Query-evidence collection and response comparison occur outside those timers.
The server timer starts in the harness middleware and ends at the response `finish` event.

All attempted measured loads stay in the denominator.
An incomplete, mismatched, failed, or unverified load has an effective duration of positive infinity.
JSON assets represent that value as `"Infinity"`.
Nearest-rank p95 uses position 19 for 20 attempts.

The command returns a nonzero exit code for a comparison failure or failed exploratory API timing threshold.
Twenty attempts supply exploratory evidence. They do not replace the 100-load page acceptance test.
Actual page times, frontend request order, and rendering completion remain unmeasured.

## Resource gates and connection

Before writes, the tool measures serialized BSON and current shared document/index usage.
It reserves one MiB for a snapshot and includes an index allowance.
It checks actual usage after each bounded batch of 50 documents.

The gates keep summary documents within 128 KiB, snapshots within one MiB, and the synthetic database within 100 MiB.
At least 25% of the shared 512 MiB quota must remain unused.
The tool keeps the current Atlas Free tier and the accepted $0 spending limit.
Aggregation operations have a 120-second diagnostic timeout.
The tool does not enable disk spill or change cluster settings.

The connection first tries normal SRV/TXT DNS.
If that lookup fails, this process obtains SRV, TXT, and IPv4 addresses through Google DNS over HTTPS.
TLS and certificate validation remain enabled.
The recorded session used this fallback because normal DNS returned `EBADRESP`.

Result files exclude credentials and CID values.
The test database and generator inputs contain synthetic CID values only.

## Output files

| File                             | Evidence                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `manifest.json`                  | Profile, data digest, resource gates, current environment, indexes, counts, and final snapshot     |
| `report.json`                    | Raw attempts, timings, correctness verdicts, case-family mapping, explain results, and limitations |
| `first-live-raw.json`            | First trials before reference capture                                                              |
| `timing-reference-live.json`     | Two stable captures for live timing                                                                |
| `timing-reference-snapshot.json` | Two stable captures for snapshot timing                                                            |
| `references/*.json`              | Exact case inputs, clock, snapshot identity, both captures, traces, and differences                |

The baseline command can write checkpoints before it completes.
Check `report.completedAt`, `comparisonPassed`, and the manifest's `state: "measured"` before using a run as completed evidence.
