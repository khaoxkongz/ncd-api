# Ticket 23: exact prepared stored-month graph scopes

Implemented on `codex/patients-ticket-23`, based on integration `2671966561806b53b8156a3b1a53e7920f9bbeee`. Card integration `327d0b44a83d2d20dc8d6e80ee94eb5e140ef121` was merged in `6dbef3b`. The measured candidate revision is `5802474bb231a09ea3793c2ced83adbcb6fe4ca1`; the accepted product reference is `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`. Evidence date: 2026-10-15. This ticket supplies backend graph code and isolated local evidence. Frontend implementation remains deferred.

## Result and remaining gates

The Builder prepares national and every observed independent equality scope for area, province, district and hospital over the full stored-period fixture history. Every prepared period has all fifteen exact patient sets and cardinalities. Province selection includes matching historical tuples across areas; hospital selection includes historical moves. Array-valued geography retains both its original equality scope and observed element equality scopes, using Mongo's query relation.

Only the same complete typed implicit equality predicate can select a prepared result. The descriptor stores the full BSON predicate bytes, original typed value, generation and checksum. Lookup uses the accepted collation-compatible `(generationId,scopeKind,value)` index, then requires the exact predicate bytes. Numeric or collation equivalence may return extra descriptor candidates from that index; it cannot substitute another typed predicate. Operators, regular expressions, combined predicates and unprepared values use the exact atom path. No hierarchy, intersection of independent patient sets, or addition of overlapping counts is used.

All three existing graph controllers still consume the same ordered twelve-by-fifteen matrix. Prepared counts are used directly for exact scopes. Atom reads now start with the complete geographic/period selection before looking up chunks, so an applicable geography index can reduce the stream. Every residual predicate is applied before union. Disease Total and clamped DM/CA Other presentation remain unchanged.

The new `preparedStored` component is complete. The umbrella `preparedScopes` remains incomplete until the separate UTC date-month family is implemented. Candidates remain `complete: false`, and `publish()` rejects them. Serving activation remains unavailable. Card's separate patient/hospital sets, kind-scoped dictionaries, independent service facts, and shared Card/Bar range selection are preserved. Stored graph atoms and prepared graph sets include only the fifteen disease categories.

Publication/control/pins, the date-UTC family, snapshots, source capacity, actual host/database headroom, refresh/correction/recovery evidence and actual frontend/page evidence remain release gates. The 15-second page target and Production acceptance are not established here.

## Storage, periods and validation

`patients_scopes` has unique `(generationId,scopeId)` and the accepted scope lookup index. `patients_month_scopes` has unique `(generationId,periodKind,periodKey,scopeId)`, a generation/set lookup, and a collation-compatible scope/period index restricted to presentable numeric periods. Scope and set identifiers explicitly include their generation. Prepared rows retain matched-row presence, all fifteen membership inventories, checksums and original typed source periods.

Stored periods remain separate from summary dates. Int32, safely promoted Long and Double periods that the baseline presents as the same numeric cell are unioned into one prepared cell. Their original BSON encodings remain in `sourcePeriods`, including an explicit BSON key so Mongo `$addToSet` cannot erase wrapper distinctions. Nonpresentable periods remain stored and validated. The ticket 22 rejection of ambiguous mixed visible/Decimal128 numeric period groups remains intact; this ticket does not normalize that unstable baseline case.

Preparation streams daily metadata, scope/period row mappings and dictionary edges, then uses the existing bounded portable chunk writer. Exact prepared sets are compared with independently selected historical atom unions, block by block, for every original period and all fifteen categories. The Builder also compares Reader results with independent baseline direct-unwind grouping across all supported numeric stored periods and every catalog scope. Reference windows and count matrices stay bounded; there is no application-memory catalog of patient identities or all historical periods. Temporary scope mappings and edges are removed and included in sampled peak storage before cleanup.

Prepared metadata is sealed after writing its sets. Reader checks generation inventories, exact descriptor identity, descriptor/period checksums and valid fifteen-category inventories before returning counts. A missing or changed selected descriptor/period fails instead of falling back to atoms. Atom and chunk integrity checks continue to reject missing/changed contributions on that path. Equal category counts alone are insufficient Builder evidence: the captured report also records exact bitmap content equality.

Versions are `patients-daily-and-stored-months-v1`, `mongo-equivalence-v1`, `roaring-2.7.0-portable`, `expense-v1`, `baseline-services-v1`, `daily-card-v1` and the added `stored-scopes-v1`. Runtime evidence is Node 24.22.0, MongoDB driver 6.10.0, MongoDB 7.0.9 and roaring 2.7.0 on Darwin arm64.

## Tests and red/green evidence

Tests use the agreed existing Express application/controllers and public Builder/Reader interfaces on real UUID MongoDB fixtures. No endpoint flags or additional public test APIs were added. The accepted immutable legacy reference artifact remains unchanged.

The first prepared-scope test failed because the Builder had no completed prepared component. It passed after national/independent preparation and Reader selection were implemented. Adding required exact set-validation evidence then failed because `setsEqual` was absent; blockwise bitmap comparison made it pass. The non-simple-collation index assertion failed for the former simple chunk/directory indexes; producer-collation indexes made it pass and the actual plans confirmed their use.

The three new tests compare full Disease, DM and CA HTTP status, content type, parsed JSON values/types/presence and ordered series/points against repeated baseline responses. They cover all fifteen categories, reused patient identities and numeric/null equality, overlapping categories and geography, historical moves, independent conflicting combinations, implicit versus operator-valued selections, typed/string/array/document/missing geography, non-simple collation, stable BSON period wrappers and stored-date disagreement. Selected descriptor/period corruption returns the approved 503 envelope without a result; operator and combined atom paths retain their complete residual predicates. Recovery after restoring fixture data confirms settled work is removed.

Existing monthly tests now explicitly exercise both the national prepared path and an equivalent operator-valued atom path at local month/year boundaries. The retained atom corruption test uses a combined selection to keep testing the atom path after national/single-field acceleration became available. Earlier raw ETL/finalization, expense, Card, dictionary/codec, cancellation, failure, snapshot-routing and inactive-serving tests remain in the suite.

Commands run:

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test scripts/patients-performance/prepared-scopes.test.js
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test scripts/patients-performance/prepared-scopes.test.js scripts/patients-performance/monthly-read-model.test.js
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-prepared-scopes.cjs
vp check <changed paths>
vp check
vp run lint
git diff --check
```

The merged full suite passes all **38 tests in eight files**. Changed-path formatting, lint and type checks pass without warnings or errors. Full `vp check` retains the same **35 untouched formatting failures**. `vp run lint` retains the existing ESLint 9.18.0 missing-flat-config failure. Installation succeeded; unrelated lockfile name-only churn was reverted. No dependencies or install permissions changed.

## Actual plans and exploratory measurements

[The repeatable sanitized report](ticket-23-fixture.json) contains complete examples of all three graph payloads for baseline, prepared and atom conditions, every measured attempt, excluded warmups, versions, source digest, generation/component inventories, actual index definitions and execution plans. Its finite summary fixture has eight rows, eight original stored-period/geography atoms, nineteen typed scope descriptors, thirty prepared scope/period records, seventeen dictionary classes and 706 chunks/directories including retained daily Card facts. It is a summary differential fixture, not proof of full raw/source capacity.

The captured Builder validated 450 exact set/block cells and 3,240 displayed category cells over eighteen scope/window checks. Its build took approximately 2,405 ms. Sampled peak RSS was 107,757,568 bytes, additional RSS 21,708,800 bytes, tracked serialized reservation 126,536 bytes, native bitmap allocation 33,216 bytes and peak additional stored BSON/index/file allocation 743,922 bytes. These are sampled/tracked local measurements, not continuous process/database accounting.

The original non-simple-collation plan used two collection scans and examined 1,380 chunk documents. The accepted unique chunk and directory key definitions now carry the producer collation. The final selected two-atom chunk lookup used `patients_chunks_f48e9b0b1e95e3e4`, performed zero collection scans and examined thirty chunk documents. No speculative geography-combination index was added.

| Captured selection                                     | Winning index                            | Keys / documents examined  |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------- |
| National stored atoms                                  | `patients_month_period_f48e9b0b1e95e3e4` | 7 / 7                      |
| Independent area atoms                                 | `patients_month_area_f48e9b0b1e95e3e4`   | 3 / 3                      |
| Combined area/province/hospital, with residual filters | `patients_month_hcode_f48e9b0b1e95e3e4`  | 2 / 2; one result          |
| Exact typed scope descriptor                           | `patients_scope_value_f48e9b0b1e95e3e4`  | 3 / 3; one exact predicate |
| Prepared scope/period                                  | `patients_scope_period_f48e9b0b1e95e3e4` | 1 / 1                      |
| One category's set chunks                              | `patients_chunks_f48e9b0b1e95e3e4`       | 1 / 1                      |

On this small fixture, the planner used the accepted period/geography prefixes and applied residual month predicates; the captured bounds show no asserted full-history selectivity. `date_1` is retained on the baseline summary fixture, and no legacy source index was changed.

There are twenty later exploratory loads per path/condition, after five recorded excluded warmups, with one active load and three parallel graph requests per load. All 240 measured loads were complete and exactly equal. Failures would remain in the denominator with effective duration infinity. Timers end after all response JSON parsing; nearest-rank p95 uses rank nineteen.

| Scenario                        | Baseline p95 ms |        Prepared p95 ms | Atom p95 ms |
| ------------------------------- | --------------: | ---------------------: | ----------: |
| National                        |            5.68 |                   7.16 |       29.70 |
| Independent area with collation |            4.29 |                   5.11 |       15.45 |
| Province across areas           |            6.77 |                   9.20 |       39.12 |
| Combined residual predicates    |            2.69 | 12.41 (combined atoms) |       12.17 |

These are small local three-endpoint exploratory API measurements. They are not first/cold-process trials, six-endpoint acceptance loads, one hundred acceptance loads, actual dashboard page measurements or Production performance evidence. No retained response cache is used. Other isolated fixture tasks may have been active on the host.

Fixed budgets were declared before running: thirty seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one serial heavy stage. No limit was enlarged after a failure. Full-volume prepared fan-out, database aggregation/index/cache memory, dense blocks, supported Production history/cardinality, combined serving/build peaks, verified host headroom and source/freshness SLAs remain unverified. Only isolated fixture databases were written and cleaned up. No Production/UAT writes or export, scheduler installation, deployment, purchase or external message occurred. Spending remains **$0**.
