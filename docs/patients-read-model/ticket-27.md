# Ticket 27: full raw refresh and corrections

The Builder now offers a callable full-refresh job. It acquires a trusted full immutable raw cut, verifies signed availability evidence, safely reuses an inactive generation slot, rebuilds all declared supported history, checks the complete candidate, and conditionally publishes it through the same Builder owner. No scheduler or source-export service is installed. The existing public backend remains in legacy mode, and activation remains blocked.

This is the backend delivery scope of [issue 27](https://github.com/khaoxkongz/ncd-api/issues/27). The user's frontend deferral is recorded there; actual dashboard rendering, freshness/error display, and visible 24-hour/page acceptance remain in [issue 32](https://github.com/khaoxkongz/ncd-api/issues/32). Local fixture success does not pass those clauses or target source, history, ingestion, topology, native compatibility, capacity, or release gates.

## Callable job and source contract

`createBuilder({ db, clock, timeZone }).refresh(request, declaredBudget, comparisonContext)` uses the existing explicit MongoDB adapter and public Builder. The request contains `cutAt`, `expectedActive`, and an asynchronous `acquire({ cutAt, deadlineAt, signal })` adapter. Acquisition must return the same producer-sealed full BSON source contract accepted by `build`. It must honor the supplied remaining deadline and cancellation signal. A late or ignored cancellation never permits publication.

The trusted producer signs `availability.mutationAvailableThrough`, `availability.exportAvailableAt`, and a bounded evidence identifier in the manifest. Mutation coverage must reach the requested cut; the export must become available between that cut and cut + two hours, and before acquisition completes. The existing source verifier separately checks producer consistency, complete finite domain, supported-history revision and exact coverage, BSON transport integrity/types, and collation. Hash agreement alone remains insufficient consistency evidence.

Source mutation availability, clinical claim date, cut, export availability, acquisition, captured snapshot clock, build stages, publication, and job completion are separate fields. Unknown upstream ingestion delay stays unverified. The job neither assumes the migration's 2024-01-01 default covers Production history nor treats the twelve current graph months as the historical domain.

## Fixed time allocation and publication

Only 11:00 and 23:00 Asia/Bangkok cuts are accepted, corresponding to 04:00 and 16:00 UTC. Normal acquisition has a two-hour cap and full build/check/publication availability has a six-hour cap. Queue time, ledger coordination, inactive cleanup, and any extra settlement time consume one combined four-hour reserve. The final boundary is always cut + twelve hours. External retry, reader, cleanup, and display work must use the remaining allocation, not claim another four hours. Actual scheduling, upstream cadence, and dashboard delay are separate release evidence.

Every phase uses the stricter of its original wall-clock boundary and observed monotonic elapsed time. A backward clock fails the run. Builder operations and publication verification/CAS receive only remaining positive server budgets. Publication cannot start after the build or final window is exhausted. No later phase or duplicate call grants a fresh six-hour window. One durable `patients_refresh_runs` record per canonical cut prevents a second invocation from silently restarting the allocation.

The run ledger is limited to 64 KiB. Generation storage accounting includes persisted run records and reserves another 64 KiB for the in-flight record. Run, cut, source/version, generation, completed-stage inventory, timings, error phase, and actual publication outcome remain available for recovery. Completed stages are persisted in the generation document after their budget/storage checks; a completed flag alone is not proof that output can be resumed. [Issue 28](https://github.com/khaoxkongz/ncd-api/issues/28) owns deeper compatible-stage resume and failure recovery.

The existing global Builder fence and two generation slots remain authoritative. Refresh calls the existing guarded cleanup before a new build. Suspect pins, outstanding work, unverified predecessor termination, or incomplete deletion still block cleanup/reuse. Aggregations and index operations remain serial. No lease expiry is converted into proof of termination.

Pre-publication failure leaves the previous full generation and its original source time readable. A successful write followed by a late reply is different: the job reports `published-late` with its confirmed publication identity. A lost write reply is resolved using the same durable publication identity and only the original run's remaining settlement reserve. If that observation cannot be completed, the job reports `publication-uncertain`; it does not claim that the old pointer survived. Exhausted budgets can also prevent the final ledger write, which is reported as unverified persistence. Neither outcome passes freshness acceptance.

## Full raw correction evidence

[The repeatable report](ticket-27-fixture.json) uses two complete finite raw revisions containing 15 and 14 synthetic records. Declared history runs from 2023-12-31 through 2025-01-08. The candidate walks every supported day through the unchanged baseline hospital-day ETL and finalizes identity once. Separate archived baseline ETL and existing baseline HTTP controllers produce the references. Sparse baseline input has no records on omitted days; those days produce no hospital-day output.

The two cuts cover late arrivals with older clinical dates, hospital-day replacement, whole-day deletion, eligibility removal, historical deletion and scalar correction, geography and disease moves, cross-hospital identity correction, a hospital/day move, and scalar correction with surviving membership. They preserve surviving hospital and patient contributions, including null membership and overlapping diseases. All fifteen categories, daily facts, both monthly families/scopes, and six compatible endpoint snapshots are built and validated.

For each cut, 21 national, independent/combined geography, affected-hospital, old-history, moved-day, late-day, and snapshot cases compare all six full status/body results exactly with a repeated stable baseline: 252 candidate responses. Integer raw amounts coincide with the approved exact expense reference; the existing decimal differential suite continues to cover approved arithmetic exceptions. Changed source headers and fresh/stale states remain separate from successful-body comparison.

Observed local refresh durations were 7.518 seconds and 5.888 seconds. Peak additional Builder RSS was 24,117,248 and 41,877,504 bytes; peak measured serialized buffers were 125,396 and 125,404 bytes; peak accounted storage was 925,883 and 1,154,983 bytes. The observed peak of concurrent refresh aggregation/index commands was one. The full report ran in 17.989 seconds. These small-fixture samples do not prove representative database memory, aggregate host headroom, p95 performance, or full-source budgets.

The schedule, clinical dates, mutation availability, and export times in this report are injected historical fixture data. Execution wall times and elapsed durations are recorded separately. The finite producer owns every synthetic record and seals its complete output before signing it; this establishes the local fixture's consistency protocol, not Production ingestion capability or an actual elapsed 24-hour experiment.

## Regression tests

Eleven added public-seam integration tests cover the raw correction matrix, normal 11:00/23:00 cycles and third-cycle slot reuse, signed-source/acquisition/history/ETL failures, duplicate-cut rejection, ledger time charged to the shared reserve, a build over six hours, and publication verification with only twenty milliseconds left. They use isolated real MongoDB databases, the public Reader/Builder, existing six HTTP controllers, and real wire-level held/lost replies. Source and stage failures preserve the entire old page and stale source time.

The first over-budget regression was red because publication happened before the time check. A second was red because publication verification started a fresh 60-second budget with only twenty milliseconds left in the build window. A third showed time spent writing the ledger was not charged to the reserve. Late reply tests distinguish a confirmed commit, a lost reply resolved by readback, and an unobservable outcome after the final deadline.

Consecutive refresh coverage also exposed a Reader race: fast graph work could release its shared pin while another registered HTTP caller was still linking to it. The focused regression holds a real Mongo calculation, starts a second graph request, holds the follower's control read, completes the first calculation, and then releases the follower. The original Reader returns 503; the fix returns 200. Shared protection now lasts until actual calculation settlement and all registered consumers finish linking/consuming. Heartbeats, suspect handling, termination proof, and cleanup guards retain their conservative behavior.

## Validation and limits

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-refresh.cjs > docs/patients-read-model/ticket-27-fixture.json
vp fmt docs/patients-read-model/ticket-27-fixture.json
vp check <changed source, fixture, report and documentation paths>
vp check
vp run lint
git diff --check
```

The eleven focused tests passed together in 93.75 seconds. The final combined run passed all 77 tests in twelve files in 139.73 seconds. The changed-path check passed: eleven formatted source/harness/report/documentation files and no warnings, lint errors, or type errors in the nine JavaScript files. `git diff --check` passed. `vp install` succeeded; only its two incidental root package-name fields in the lockfile were restored. No dependency version changed.

Full `vp check` retains the same 35 untouched baseline formatting failures. `vp run lint` retains the existing ESLint 9.18.0 missing `eslint.config.*` failure. Neither is introduced by this ticket, and neither is reported as passing. The integration branch was still `786b3d1` at final validation; merging it into this ticket branch was already up to date.

Actual runtime is Node 24.22.0, MongoDB driver 6.10.0, MongoDB 7.0.9, roaring 2.7.0, Vite+ 1.1.0, and Vitest 5.0.3 on Darwin arm64. Fixture limits remain 30 seconds for Builder build, 8 MiB source, 32 MiB storage, 128 MiB additional Builder RSS, 8 MiB serialized buffers, 1 MiB full chunk, 960 KiB payload, and one heavy operation. The accepted Production ceilings are unchanged. All writes/faults/cleanup are isolated explicit loopback fixtures. The $0 cap and read-only source boundary remain. No Production/UAT write, source export, scheduler installation, deployment, or external message occurred.

Target immutable source/history/ingestion, representative full workload and concurrent serving headroom, Linux amd64 native compatibility, actual target topology and termination/failover proof, deeper recovery, and actual visible 24-hour/page evidence remain required. Operator current-usage observations outside the ETL window do not establish accepted headroom or any of these gates. Dashboard work stays in issue 32.
