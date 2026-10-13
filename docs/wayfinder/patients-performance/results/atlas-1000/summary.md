# Patients Atlas baseline report

Completed on 2026-10-13 (Asia/Bangkok).

Task: [Prepare data and measure the Atlas baseline](https://github.com/khaoxkongz/ncd-api/issues/7).

All 97 response cases match repeated baseline captures. All 60 measured API loads completed correctly.
The slow UAT response has not been reproduced by this small synthetic profile.
These results do not establish the UAT bottleneck or Patients page acceptance.

## Data and environment

| Item                                          | Recorded value                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Baseline product revision                     | 2deb5b2e05c77f685075d59c5d8fa61a3ebc42fe                                             |
| Profile                                       | patients-synthetic-v1-1000-shared-seed-20261013                                      |
| Random seed / algorithm                       | 20261013 / Mulberry32                                                                |
| Summary documents                             | 1000: 100 fixed and 900 seeded                                                       |
| Active snapshot documents                     | 1                                                                                    |
| Observed distinct synthetic CIDs              | 2000                                                                                 |
| Memberships across all 15 arrays              | 95147                                                                                |
| Summary BSON bytes / maximum document         | 7989080 / 16134                                                                      |
| Final total data bytes / index bytes          | 7993318 / 3203072                                                                    |
| Final synthetic document plus index footprint | 10.68 MiB                                                                            |
| Final shared document plus index footprint    | 18.15 MiB of 512 MiB                                                                 |
| MongoDB / topology                            | 8.0.34 / replica set, 3 nodes                                                        |
| Atlas tier / region / additional spending     | Free M0 / AWS Singapore / $0                                                         |
| Node / MongoDB driver                         | v24.21.0 / 6.10.0                                                                    |
| Local host                                    | darwin, arm64, Apple M2, 8 logical CPUs, 8 GiB memory                                |
| Normal calculation clock                      | 2026-10-13T05:00:00.000Z                                                             |
| Effective normal time zone                    | Asia/Bangkok                                                                         |
| DNS method                                    | Google DNS over HTTPS for SRV, TXT, and IPv4 addresses; normal DNS returned EBADRESP |

TLS and certificate validation stayed enabled. The process selected ncds_perf_synthetic explicitly.
The existing .env file still selects the application's configured database.
The stored BSON digest matches the generated documents. The manifest records geography, distributions, reuse checks, and resource gates.
No growth profile was loaded or measured on Atlas. Generator tests verified all six larger profile variants locally.

The nine actual summary indexes are:

- _id_
- date_1
- date_1_hcode_1
- date_1_district_1
- date_1_area_1
- date_1_province_1
- date_1_district_1_area_1
- date_1_district_1_area_1_province_1
- date_1_hcode_1_district_1_area_1_province_1

The snapshot collection has its _id index. The unique date/hcode index and other keys match the baseline model.

## Combined API timing

Only one load was active at a time. Each load dispatched all five requests in parallel.
First live trials had no same-request warmup and preceded reference capture.
Their traces contain 26 successful summary aggregations per load and no snapshot queries.
Later live trials followed five warmups. Stored-snapshot trials also followed five warmups.
A snapshot load contains five projection aggregations and no live summary queries.

| Scenario                    | Warmups | Attempts | Combined p95, ms | Correct within 15 seconds | Failed |
| --------------------------- | ------: | -------: | ---------------: | ------------------------: | -----: |
| first-live-national-longest |       0 |       20 |            548.5 |                     20/20 |      0 |
| later-live-national-longest |       5 |       20 |            510.5 |                     20/20 |      0 |
| later-snapshot-national     |       5 |       20 |             54.1 |                     20/20 |      0 |

Nearest-rank p95 uses position 19 for 20 attempts. Failures would remain in the denominator with an effective duration of Infinity.
Comparison and query-evidence collection occurred outside the client timers.
Endpoint time ends after complete JSON parsing. Combined time ends after all five bodies have been parsed.
The server timer runs from the harness middleware entry to the response finish event.

## Endpoint and server timing

| Scenario                    | Part          | Endpoint p95, ms | Server p95, ms | Aggregations per request |
| --------------------------- | ------------- | ---------------: | -------------: | -----------------------: |
| first-live-national-longest | Card          |            460.1 |          458.1 |                        2 |
| first-live-national-longest | Bar chart     |            436.9 |          432.1 |                        7 |
| first-live-national-longest | Disease graph |            396.3 |          389.5 |                        6 |
| first-live-national-longest | DM graph      |            547.5 |          540.1 |                        5 |
| first-live-national-longest | CA graph      |            525.1 |          517.6 |                        6 |
| later-live-national-longest | Card          |            510.4 |          506.7 |                        2 |
| later-live-national-longest | Bar chart     |            343.7 |          339.0 |                        7 |
| later-live-national-longest | Disease graph |            336.5 |          330.0 |                        6 |
| later-live-national-longest | DM graph      |            303.2 |          293.9 |                        5 |
| later-live-national-longest | CA graph      |            331.1 |          319.5 |                        6 |
| later-snapshot-national     | Card          |             50.2 |           48.3 |                        1 |
| later-snapshot-national     | Bar chart     |             52.2 |           45.7 |                        1 |
| later-snapshot-national     | Disease graph |             53.3 |           49.9 |                        1 |
| later-snapshot-national     | DM graph      |             53.4 |           49.7 |                        1 |
| later-snapshot-national     | CA graph      |             50.9 |           44.9 |                        1 |

Individual endpoint percentiles do not add up to combined p95.
Per-query durations and fingerprints remain in the raw attempts and response references.
125 representative pipeline shapes received separate executionStats explain operations.
0 explain operations failed. Explain times do not contribute to the measured user wait.

## Response evidence

The case matrix covers all 14 accepted families. Each reference file contains the exact request, clock, time zone, data variant, route evidence, and two captures.
All statuses, JSON field presence, types, numbers, arrays, labels, and ordering matched exactly.
No candidate implementation was tested. These stable captures supply references for later changes.

The controlled cases preserve these distinct outcomes:

- Empty collection and no matching scope produce valid baseline empty or zero results.
- Empty patient arrays with positive scalars produce the expected Card error. The other parts remain independently checked.
- An injected failed aggregation produces a Card error, Bar zeros, and omitted graph results. Query traces retain those failures.
- A missing snapshot returns HTTP 200 with omitted result fields. It does not qualify as successful page completion.
- A stale snapshot uses a stable capture and timestamp 48 hours before the comparison clock. It has its own reference.

The final snapshot uses the normal fixed clock. Its payload digest, BSON size, and timestamp remain in the manifest.
Synthetic timestamps do not establish real source freshness or the UAT 24-hour data-delay condition.

## Run again and remove data

Run from the repository root:

```sh
vp exec node scripts/patients-performance/run.cjs
```

For the complete procedure, see [the tool instructions](../../../../../scripts/patients-performance/README.md).
The run retains the synthetic documents for inspection and repeat measurements.
To remove only those documents and keep indexes:

```sh
vp exec node scripts/patients-performance/run.cjs --command cleanup
```

Cleanup verifies the exact synthetic database, the manifest collection allowlist, and profile ownership.
The same guarded deleteMany method was exercised by this run's controlled data and snapshot replacements.

## Validation and limits

All 37 Vitest tests passed. Checks for the new tools and result assets passed.
The full repository check still reports existing source formatting issues.
With formatting skipped, it reports the existing crypto global redeclaration in src/lib/utils.js and three warnings.
Product source, credentials, and application configuration have no changes.

This is an exploratory 20-attempt sample per condition. It does not replace a 100-load page acceptance test.
The harness mounts the actual five controllers but omits unrelated application initialization and middleware.
MongoDB internal cache state and shared-cluster activity were uncontrolled.
The actual frontend request order, rendering completion, page latency, UAT data, UAT revision, and UAT resources remain unmeasured.

## Machine-readable evidence

- [Manifest](manifest.json)
- [Raw report, attempts, and explain results](report.json)
- [First live attempts before reference capture](first-live-raw.json)
- [Live timing references](timing-reference-live.json)
- [Snapshot timing references](timing-reference-snapshot.json)
- [Response comparison directory](references/)
