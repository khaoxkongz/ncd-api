# Ticket #21: exact daily Card

Implements [#21](https://github.com/khaoxkongz/ncd-api/issues/21) against the accepted [#17 specification](https://github.com/khaoxkongz/ncd-api/issues/17). Work started on integration commit `14adb5e7d79b24c3e12f6dfcd5ecb9f13d5e5d83`, with the expense policy from #20. Graph integration `2671966` was merged before final validation; its stored-month stage, fifteen-category schema and graph adapters remain available. The initial Card implementation is commit `68970f8`, and the integration merge is `bfcd305`.

The existing Card controller can read the private process-side validation candidate. The default legacy backend and its service remain unchanged. `NCD_PATIENTS_BACKEND=read-model` remains unavailable, and no request input, new public route or endpoint flag selects this candidate. The generation stays `candidate-partial`, `complete:false`; publication rejects it. Snapshots, date-month/prepared scopes, control and complete publication inventories remain unfinished. Frontend implementation is deferred.

## Daily facts and presentation

`daily-card.js` derives the six-array Mongo `$setUnion` for each source row before dictionary assignment and global union. A row with a null or missing operand retains the resulting null Card presence even when a disease Bar has patients. The original per-category missing/null states remain recorded. `CARD` is a separate auxiliary bitmap set; it is never reconstructed by OR-ing the six Bar sets.

The Builder evaluates the separate six-service `$add` inside a Mongo group and retains its original BSON result. This preserves the baseline group operator path for sparse operands: projecting `$add` alone can choose a different Mongo execution path and produce a different error. The per-row lookup uses an indexed staging row identity. Known Mongo 7.0.9 `$add` type/multiple-date data errors become explicit Card error facts; other database errors reject the candidate. A Card read of those error facts keeps the existing generic HTTP 500 while the independent Bar facts remain usable. Null/missing operands, date operands, non-finite values, Decimal128 and Long behavior are checked against the actual baseline controllers. Service averages retain the baseline Number/division/`toFixed(2)` arithmetic and driver promotion.

For each matched row, a Mongo `$addToSet` derives its hospital contribution. Missing hospital fields contribute no value; an explicit null is a counted value. Hospital identity uses the same Mongo grouping and exact-expression/index-checked lookup mechanism as patient identity, with separate dictionary `kind:"hospital"`. Numeric equivalence, arrays, embedded-document field order, Binary, ObjectId and source collation retain baseline grouping behavior. `HOSPITAL` is an independent auxiliary set, including scalar-only rows. These two auxiliary categories are excluded from the stored graph family, which continues to contain exactly fifteen categories.

Each daily Card scalar/presence fact has version `daily-card-v1` and a BSON checksum. Selected reads check that checksum, both auxiliary set inventories, chunk/directory integrity, generation versions and Card/hospital component identities. Missing, changed or incompatible facts return the approved HTTP 503 with no result. The common schema remains `patients-daily-and-stored-months-v1`, with separate expense, service and Card identities.

The presenter adds the six unrounded `expense-v1` totals, rounds the final amount once, and rounds the exact unrounded total divided by the Card union count. It never adds rounded Bar display amounts. Selected unsafe numeric JSON conversion becomes 503; full-history unsafe final output rejects the candidate. A genuinely empty range returns the baseline one-element zero Card array. Matched rows with no global Card patients retain the protected HTTP 500, including when positive scalars exist. This error is checked before normalized expense presentation.

The three live range adapters name the same internal live range route after their baseline routing/coercion rules succeed. In-flight work is shared only for equal complete typed BSON keys containing selection/date predicates, route, generation, versions, backend and timeout policy. Snapshot paths remain separate. Settled entries are removed. Freshness is attached after shared calculation using each caller's captured clock; cancellation of one caller does not invalidate another caller's calculation. Full publication pins and remote cancellation proof remain later control work.

The Builder also compares the full supported fixture history against independent Mongo baseline Card union, `$addToSet` and `$sum/$add` references, then validates the normalized Card amount and ratio when the baseline Card exists. Its validation report distinguishes baseline Card error conditions from read-model failure.

## Fixtures and red/green evidence

Tests use the accepted existing HTTP application/controllers and public Builder/Reader interfaces on real MongoDB UUID fixture databases. The baseline application is archived from exact revision `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`. The existing 121-case six-endpoint legacy reference remains unchanged. The full raw cut passes through the baseline ETL and identity finalization; direct signed summary fixtures separately exercise BSON and error behavior that raw ETL does not produce.

Seven new tests cover the Card plus both Bars on the same cut, 39 exact paired baseline Card selections, independent typed/conflicting geography, arbitrary long and inclusive intraday ranges, invalid/omitted/typed/reversed dates, cross-disease/hospital duplicates, null/missing arrays, scalar-only rows, missing versus null hospitals, BSON and collation equality, service arithmetic/data errors, empty input, normalized rounding, unsafe serialization, corruption, component compatibility, recovery and shared-caller freshness/cancellation.

Independent normalized examples include two disease totals of `0.004`: Bar amounts are both zero, while the Card amount is `0.01` and its two-patient average is zero. Totals `1.005 + 2.675 + 12.345 - 1.005 + 0.004 + 0.004` produce Card `15.03`, with two-patient average `7.51`. A total of `-0.01` divided by two rounds to `-0.01`. Two individually safe disease amounts `45035996273704.96` and `45035996273704.97` reject the candidate because the combined Card cents cannot survive numeric JSON conversion exactly.

Observed red stages followed by green reruns:

1. The raw-cut Card route returned 503; added daily Card facts and the private existing-controller adapter.
2. The independent Card validation result was absent; added full-history differential and normalized final-output validation.
3. Sparse/BSON service fixtures exposed a projection-versus-group error difference and wrapped/SBE Mongo error codes; retained the baseline grouped operator result and explicit Card data-error state.
4. Two shared callers both received the first caller's freshness; moved clock-dependent freshness after the shared calculation.
5. The graph integration rejected auxiliary Card/hospital chunks as unexpected graph categories; limited stored graph staging to its fifteen categories and reran the full suite.

Commands run:

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test scripts/patients-performance/card.test.js
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-card.cjs > docs/patients-read-model/ticket-21-fixture.json
vp check <changed paths>
vp check
vp run lint
vp toolchain
git diff --check
```

All 35 tests in seven files pass after the graph integration. Changed-path formatting/lint/type checks pass with no warnings. Full `vp check` fails on the same 35 pre-existing formatting files. `vp run lint` fails because ESLint 9.18.0 cannot find a flat config. No unrelated formatting/configuration remediation was made. `vp install` succeeds with the existing `roaring@2.7.0` install-script approval; its existing audit reports 21 vulnerabilities. The install-only package-name lockfile rewrite was restored.

## Actual measurements and remaining gates

[The sanitized repeatable local report](ticket-21-fixture.json) records Node 24.22.0, Mongo driver 6.10.0, MongoDB 7.0.9 and roaring 2.7.0 on Darwin arm64. Vite+ is 1.1.0 and Vitest is 5.0.3. Build timezone is Asia/Bangkok; HTTP calculations use a separately fixed UTC clock.

The captured synthetic full raw cut has ten records and 2,434 source bytes. It produces four daily rows, eight dictionary classes across patient and hospital kinds, two stored graph atoms, and 25 bitmap chunks with 25 independent directory entries. The Card returns 9 services, 6 patients, 2 hospitals, expense 370, average services 1.5 and average expense 61.67. Both complete Bar payloads are recorded alongside it. This build took about 1,003 ms; the parsed Card/Patients Bar/expense Bar bodies took about 70/15/14 ms in this one run.

Observed Builder RSS peaked at 109,445,120 bytes, additional RSS at 24,592,384 bytes, native bitmap allocation at 2,624 bytes, and tracked serialized reservation at 104,004 bytes. Peak charged stored BSON/index/file allocation was 469,378 bytes. The serialized metric is a conservative owned-buffer/copy reservation, not total driver/database memory instrumentation. These are single small local observations, not p95, page, target-host or Production acceptance.

Fixed fixture limits remain 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one serial heavy stage. Reader responses retain their 60-second ceiling. Overruns reject a build or selected read; no limit was enlarged to pass a fixture.

Full-source supported-history/consistency proof, target Node/native/Mongo compatibility, actual host/quota headroom, database memory and CPU/IO, dense/large data, concurrent API/build/database peaks, complete inventories/publication/fencing/pins/cleanup, snapshots, refresh/freshness SLAs, metadata/error consumer and actual six-result dashboard rendering/performance remain release gates. The $0 spending cap and read-only source permissions remain. All writes and cleanup used isolated loopback UUID fixture databases. No deployment source, Production/UAT write or export, scheduler installation, spending, deployment or external message was used.
