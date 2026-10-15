# Ticket #24: exact UTC-date months for Card and both Bars

Implements [#24](https://github.com/khaoxkongz/ncd-api/issues/24) under the accepted [#17 contract](https://github.com/khaoxkongz/ncd-api/issues/17). Work started from integration `327d0b44a83d2d20dc8d6e80ee94eb5e140ef121` and merged the prepared stored-graph work at `cfa3a5a8515febe55cbfe5aa22a6901b1b020506` before final validation. Implementation commits are `a862116` and `8497b24`; the fixture report pins the latter exact code revision. The accepted product reference remains `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`. Ticket #23 owns the shared typed scope catalog; its committed helper is reused unchanged.

The existing Card and two Bar controllers now use exact date-month membership unions and unrounded expense scalars when the original inclusive date predicate contains an entire equivalent UTC month. The generation remains `candidate-partial`, `complete:false`; publication still rejects it. The shared serving selector remains in legacy mode. Snapshots, control/publication and release evidence remain gates. There is no new public route, request flag or frontend generation token. Frontend implementation is deferred.

## Selection, identity and arithmetic

`patients_date_month_atoms` is separate from the fifteen-category stored graph family. It preserves each original typed historical `(hcode,area,province,district)` tuple, UTC date-month bounds, six base disease sets, and the independent `CARD` and `HOSPITAL` auxiliary sets. Neither Card set is reconstructed from disease totals. Scalar-only source rows remain present, including their hospital identity and expense/service operands. Stored source year/month is never substituted for the source date.

`patients_date_month_scopes` holds national and observed independent single-field scope sets. It reuses `patients_scopes` and its complete BSON predicate keys, source collation and descriptor checksums. Array elements observed in geography fields retain Mongo scalar-match participation. A multi-field conjunction, query operator or unsupported exact catalog key uses historical atoms selected through every effective predicate. No current hospital geography is inferred. Prepared and historical contributions are alternatives for a selected month, so they cannot overlap each other.

Only scalar, valid BSON dates with representable complete UTC month bounds enter this monthly family. Array-valued, missing or other dates remain daily facts. The Reader uses a full month only when its first millisecond is at or after the inclusive start and its last millisecond is at or before the inclusive end. It never extends the endpoint end date. Other rows remain under the original Mongo date predicate. Partial/intraday edges, leap days, year boundaries and explicit local offsets retain exact millisecond selection; a selection without a complete month uses the existing daily path. Date arrays with Mongo predicate behavior also use exact daily data.

The Reader starts from indexed selected date/scope metadata and joins only eligible chunks/directories. It streams eligible monthly and daily chunks together in disjoint ordinal blocks, without scanning unrelated stored-graph or prepared-family chunks first. It unions identities across all selected months, hospitals and edges before adding block cardinalities. One union bitmap and one decoded contribution are held for the range calculation; no complete identity set or full partition catalog is retained in JavaScript. Mongo cursors use one-record batches and database sorts disable spill. All six canonical `expense-v1` subtotals are added exactly once, without rounding. Card rounds the six unrounded totals once, while the expense Bar keeps its independent disease denominators and totals.

Monthly metadata also retains independent disease service totals and the separate per-row Card service-add result/error state. Those service sums are not generally associative across Mongo numeric kinds. The request therefore keeps one Mongo accumulator over the original selected daily service operands, preserving baseline returned types, null/error behavior, Number arithmetic and service averages. It streams typed daily service seals and Card checksums before that accumulation. This retains daily scalar-read work even for a long monthly range; monthly membership and expense acceleration does not establish full-workload timing acceptance.

## Integrity and independent validation

Date atoms and prepared month metadata have BSON checksums, component/version identities and full row/set inventories. Daily original service operands have a separate typed checksum. The Reader checks selected set directory digests, independent directory entries, decoded payload checksums/intervals/cardinalities, selected contribution totals, generation inventories, service seals and exact expense checksums. Missing, changed or incompatible data fails the selected request with 503; it cannot become a successful empty result. Settled shared work is removed, preserving the existing routing keys and each caller's clock/cancellation behavior.

The Builder independently derives UTC months with Mongo `$dateTrunc`, then compares exact bitmap contents from daily facts, historical date atoms and prepared date scopes for every observed scope/month/category/block. It compares sets rather than only cardinalities. Existing full-history original-summary Card/Bar references and normalized expense checks also run. The stored graph family retains exactly fifteen categories and its own prepared-set validation.

Five new tests use the agreed existing Express application/controllers and public Builder/Reader seams on real MongoDB UUID fixture databases. They cover:

- Thirty-nine complete range-route comparisons with the archived baseline, with each baseline response repeated to check stability; three graph comparisons with source dates in 2023–2025 and stored graph periods in October 2026.
- Thirty more complete route comparisons for collation, typed/array geography, historical moves, independent fields and conjunctive/operator predicates.
- Eighteen complete monthly versus daily-only route comparisons. The daily-only source uses singleton date arrays with equivalent selection for these requests, and its build reports zero date atoms. Cases include sparse Card operands, explicit null members, scalar-only rows and Card service data errors.
- Independent normalized amounts: three DM operands of `0.004` plus a separate HT operand of `0.004` produce Card expense `0.02` and average `0.01`; DM Bar amount/average is `0.01`, HT amount/average is zero. Repartitioning the DM operands into one `0.012` operand preserves all three complete national responses.
- Fail-closed corruption and recovery, including changed monthly expenses/presence/member metadata, a same-cardinality payload replacement with a matching replacement directory, and changed original daily Card/disease services under both monthly and partial-day paths.

Observed red/green cycles were: the date-month component was incomplete; the prepared-date component was absent; a same-cardinality replacement payload plus directory returned a successful changed Card; a full-month read accepted a changed daily service; and the partial-day path accepted a changed disease service. The corresponding component, prepared-scope, sealed-directory and typed daily-service changes made each case pass. The final complete suite passes 43 tests in nine files after integration with #23.

## Actual local evidence and limits

[The sanitized fixture report](ticket-24-fixture.json) records the exact candidate code revision, source digest, source coverage, full response bodies and parsed-body timers, actual indexes, query plans, validation, stage/resource measurements, versions and remaining gates. The source is a signed, finite synthetic **summary fixture**, not a raw-source completeness or Production capacity claim. It has 13 records and 6,114 source bytes, covering December 2023 through March 2025. It produces 13 daily rows, 11 historical UTC-date atoms, 45 prepared UTC-date scope-months, 11 scope descriptors, six stored graph atoms, eleven prepared stored periods, nine dictionary classes, and 226 chunks plus 226 independent directory entries. The date-stage exact-set comparison checks 137 nonempty scope/month/category/block unions.

The main January 2024 through March 1, 2025 selection returns Card 20 services, five patients, three hospitals, expense 130, average service 4 and average expense 26. The partial/intraday selection returns 11 services, five patients, two hospitals and expense 90. The report's five sampled metadata/scalar/chunk/directory lookup plans all use `IXSCAN`. Its actual Reader aggregate explains also show indexed metadata roots and source-collated chunk/directory lookups with zero collection scans. These plans describe the recorded fixture queries, not a full-workload capacity proof. Short selections without a complete UTC month retain the existing daily query path; other query tuning remains outside this ticket.

Runtime is Node 24.22.0, MongoDB 7.0.9, driver 6.10.0 and roaring 2.7.0 on Darwin arm64. Vite+ is 1.1.0 and Vitest is 5.0.3. Builder timezone is Asia/Bangkok; HTTP clocks/timezones are fixed separately. Schema remains `patients-daily-and-stored-months-v1`, with independent `date-utc-months-v1` and `date-utc-scopes-v1` identities alongside existing dictionary, codec, expense, service, Card and prepared-stored versions.

The recorded build took about 2,284 ms. Observed Builder RSS peaked at 117,506,048 bytes, additional RSS at 32,653,312 bytes, native bitmap allocation at 36,528 bytes, serialized reservation at 124,852 bytes and charged peak storage at 702,434 bytes. The nine single parsed-response measurements ranged from about 13 to 87 ms; they are exploratory endpoint observations and cannot establish page or capacity acceptance.

Fixed fixture ceilings remain 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one heavy build operation. Reader requests retain their 60-second ceiling and 128 MiB additional-memory ceiling. No limit was enlarged. The serialized metric reserves owned buffers/copies rather than instrumenting all driver/database memory. The report is a single small local observation, not p95, a full dashboard load or page acceptance.

Commands run:

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test scripts/patients-performance/date-ranges.test.js
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-date-ranges.cjs > docs/patients-read-model/ticket-24-fixture.json
vp check <changed paths>
vp check
vp run lint
vp toolchain
git diff --check
```

Changed-path format/lint/type checks pass without warnings. Full `vp check` still reports the same 35 untouched formatting files. `vp run lint` still fails because ESLint 9.18.0 has no flat configuration. `vp install` succeeded with the existing audit result of 21 vulnerabilities and existing native package approval; its package-name-only lockfile rewrite was restored. No unrelated configuration or formatting repair was made.

Full source/history consistency, representative full cardinalities, target native/runtime compatibility, host/quota headroom, database aggregation/index/cache memory and CPU/IO, dense/large data, aggregate concurrent API/build/database peaks, complete control/publication/pins/cleanup, snapshots/freshness, refresh recovery and actual dashboard rendering/performance remain release gates. Frontend work remains deferred. The $0 spending cap and read-only source permissions remain. Every write and cleanup used isolated loopback UUID fixtures. No Production/UAT write, deployment source/export, scheduler installation, spending, deployment or external message occurred.
