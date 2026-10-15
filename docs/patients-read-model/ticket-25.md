# Ticket #25: backend snapshots, errors and freshness

Implements the backend portion of [#25](https://github.com/khaoxkongz/ncd-api/issues/25) under the accepted [#17 specification](https://github.com/khaoxkongz/ncd-api/issues/17). Work resumed from the existing uncommitted ticket worktree based on integration `327d0b44a83d2d20dc8d6e80ee94eb5e140ef121`. The user deferred frontend implementation. [#32](https://github.com/khaoxkongz/ncd-api/issues/32) carries the actual dashboard consumer, rapid-filter rendering, visible freshness/error completion and page-acceptance work. These frontend clauses have not passed, and remain release gates.

## Backend behavior

The Builder captures one snapshot calculation clock and timezone, and makes one generation-bound document containing all six compatible endpoint views from the candidate Reader's facts. It records source/version/history, original range selection, twelve stored periods, calculation clock/timezone and expense/service policy identities. It uses the baseline snapshot producer's fixed range start and Date string conversion, including its loss of milliseconds. Graph periods use the captured server-local month and preceding eleven months. Stored views are not refreshed to a later request window.

Card and expense snapshots use the same `expense-v1` unrounded totals, final amount rounding and exact-total/patient ratios as live responses. They do not reconstruct amounts from rounded legacy displays. Services retain baseline arithmetic. A failed full snapshot stage rejects the candidate rather than storing missing results or zeros. The existing live Card matched-row/empty-patient error remains HTTP 500; it is not changed into a model failure or zero result.

The Reader selects the first matching generation-bound view document, with no main-key predicate, sort, current-window replacement or live fallback. Full document completeness, version compatibility, BSON checksum, row shapes, numeric expense safety, selection/period provenance and the generation inventory must agree. Valid stored `[]` outputs remain successful. Missing, null, malformed, incompatible or corrupted necessary views return the approved HTTP 503 body, `{status:false,message:"Read model unavailable"}`, with no result field.

The six existing controllers and their adapters carry source metadata in an internal envelope. HTTP success bodies retain the existing fields, labels, types and order. No generation, dictionary or patient identifier is added to the protocol. Card/Bars retain their loose snapshot comparisons, including false, zero and array coercion. Graphs retain strict empty-string routing; omitted, null, false and zero inputs remain live. Existing pre-read input coercion behavior and unrelated legacy errors remain covered.

`X-NCD-Source-Cut` names the effective view's known ISO source-cut time, including a BSON Date source cut. `X-NCD-Data-State` is fresh only for verified full raw coverage at a nonnegative age of at most 24 hours. Older verified data is stale; unknown coverage, absent time and future cuts are unknown. A historical or unknown snapshot keeps its own provenance within a newer generation. Recent build time never establishes freshness. Failures and responses without verified view provenance carry unknown state without a source timestamp.

Every six-route response carries `Cache-Control: no-store`. Metadata is exposed through CORS without removing existing exposed headers; names are deduplicated without case sensitivity. Conditional POST requests still return their current bodies and freshness metadata. Legacy responses receive unknown state because the legacy path has no verified source-cut provenance.

The candidate remains incomplete and cannot be published or selected by `NCD_PATIENTS_BACKEND=read-model`. Tests use the existing private process-side candidate validation context. There is no HTTP activation flag or test-only public route. Publication, safe pins, two-slot retention and operational release checks remain later work.

## Tests and observed red/green results

Tests use the existing Express application and six public POST controllers plus the accepted Builder/Reader interfaces on real MongoDB UUID fixture databases. The accepted baseline archive remains `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`; the immutable 121-case six-endpoint legacy reference is unchanged. Earlier missing-snapshot tests now explicitly remove or disable their fixture view instead of assuming the component has not been implemented.

Ten snapshot tests cover all six nonempty/empty results; normalized positive/negative ties and zero denominators; loose/strict routing and input types; first selection among multiple views; older/unknown/future provenance; the exact 24-hour boundary; CORS preservation and cache headers; absent/null/corrupt/incompatible/unsafe views; captured local periods despite a later request clock; intraday Date conversion; accepted BSON Date source time; request cancellation/budget rejection; and a failed snapshot build leaving the previous explicitly bound generation readable with its old timestamp. Existing tests retain the protected Card error and input-coercion references. There is no claim of publication, remote cancellation or frontend evidence from these tests.

Observed failing assertions followed by implementation and passing reruns:

1. A malformed stored service average or Card service field was accepted as a compatible HTTP 200 view. Shape/type checks now reject the whole unusable view at HTTP 503.
2. A snapshot at `05:00:00.500` included a row at `05:00:00.250`, although the baseline Date interpolation ends at `05:00:00.000`. The Builder now preserves that baseline conversion; the separate live ISO-date request still includes the row.
3. An accepted BSON Date cut made stored responses unavailable and omitted known live provenance. Generation provenance now canonicalizes that known instant to ISO before storing or returning metadata.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-snapshots.cjs > docs/patients-read-model/ticket-25-fixture.json
vp check <changed paths>
vp check
vp run lint
git diff --check
```

Before integration of parallel work, all 45 tests in eight files passed. Checks on the changed source, complete contract harness and report passed: 47 formatted files and 44 files without lint/type warnings or errors. Full `vp check` retains 35 pre-existing untouched formatting failures. `vp run lint` retains the ESLint 9.18.0 missing-flat-config failure. `vp install` succeeded with the pinned optional `roaring@2.7.0` and its existing exact script approval; only the incidental root package-name lockfile rewrite was restored.

## Evidence and limits

[The repeatable sanitized report](ticket-25-fixture.json) captures the six stored and six live bodies/headers, six stale stored responses with unchanged source time/body, and six explicit missing-view 503 responses. The synthetic sealed raw source contains ten records and 2,434 bytes covering its full declared finite domain on 2024-01-07/08. The captured snapshot calculation is 2024-01-09 05:00 UTC. This is isolated local API evidence; it establishes no real dashboard request order, rendering, page timing, Production coverage or capacity.

The report records actual build/stage time, each parsed-body timer and combined wall time, inventories and sampled RSS/native/serialized/storage peaks. These are small local observations, not p95 or complete OS/database instrumentation. Fixed fixture budgets remain 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payloads, 1 MiB complete chunk BSON and one serial heavy stage. Response budgets remain at most 60 seconds. No budget was enlarged after failure.

Actual environment: Node 24.22.0, MongoDB driver 6.10.0, MongoDB 7.0.9 and roaring 2.7.0 on Darwin arm64; Vite+ 1.1.0 and Vitest 5.0.3. The host's build timezone is Asia/Bangkok; snapshot calculation timezone is explicitly captured separately, and UTC/Bangkok boundaries are tested.

Full immutable Production source/history/ingestion proof, representative capacity and latency, actual host/quota headroom and database/CPU/IO peaks, concurrent serving/refresh, control/publication/pins/cleanup, refresh/recovery/freshness SLAs, target runtime/native compatibility and the actual consumer/page evidence in #32 remain release gates. All writes and cleanup used isolated loopback UUID databases. No Production/UAT source, export, scheduler installation, spending, deployment or external message was used. The $0 spending limit and legacy deployment default remain.
