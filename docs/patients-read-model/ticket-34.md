# Ticket 34: six-route load and evidence tooling

The backend tooling records one active six-controller load, exact independent
references, every attempted outcome, and actual dependency settlement. It does
not authorize optimized deployment. Original page, source, capacity, freshness,
and release acceptance remain open; frontend work is deferred in ticket 32.

## Interface and evidence

`runLoads(plan, { openApplication, outputDirectory })` owns first/later sessions,
timing, comparison, bounded artifacts, and summaries. It accepts explicit
synthetic isolated-fixture plans. The actual application opener still uses the
existing Express application and six routes; there is no new HTTP route,
parameter, activation setting, or response-cache result.

The source is a sealed full raw BSON fixture. Its manifest, exact source digest,
record count, domain/history, baseline revision, repeated-reference digest,
typed request wire bytes, calculation clock/timezone, generation seal and policy
versions are bound into the report. Each new child reports its actual PID/birth,
runtime, selected generation/source and Builder capacity identity. The private
response completion handoff records the generation actually pinned and the
capacity policy actually installed for that response. Independent first sessions
receive a policy signed for their actual process incarnation; an old Builder run
or recovery budget is not reset.

The reference preparation archives accepted baseline
`0a1934df24b1b66a2edbe2cb3e8235a7073932a7` and applies its unchanged ETL to the same
finite raw rows. Each six-route body capture must succeed and repeat exactly
before candidate construction. This fixture uses integer expenses, so baseline
and expense-v1 results agree; the existing independent expense edge goldens are
retained separately. The original 121-case legacy reference is never rewritten.
The report states that these application-harness baseline captures do not verify
legacy driver-error coverage. Candidate telemetry cannot certify another
process's error evidence.

Every capture retains six route slots with full raw response-body artifacts,
HTTP status, relevant headers, parsed-body endpoint times and one combined wall
time. The combined timer ends after all six full bodies parse or fail. It is not
a sum of parallel durations. `Promise.allSettled` keeps the other routes after
one failure. A 15-second target does not truncate the tail: the fixture transport
observation bound is 65 seconds, the optimized response deadline remains 60
seconds, and dependency drain has a separate bounded observation period.
Startup and drain times are recorded separately from API body timing.

The exact comparator preserves JSON types, field presence, values and array
order. Header checks include source-cut omission, data state, no-store, content
type and explicit-origin CORS. Only HTTP-defined comma-token sets use
case-insensitive token comparison. The fixture's selected snapshot keeps its
actual source and period semantics. Existing cache-revalidation regressions
remain in the full suite.

## Genuine settlement and query errors

The child enables actual MongoDB-driver command monitoring before connection.
Command identity includes connection/service identity and request ID, hashed
locally. Reports retain bounded names, numeric or approved symbolic error codes,
counts and monotonic durations. They retain no command documents, query filters,
server addresses, replies, arbitrary messages, stacks, credentials or patient
identifiers. Actual command failures, retries, operation-level driver failures,
write errors and write-concern errors invalidate a positive load. Missing,
malformed, overflowing, late or unresolved evidence fails verification.

A quiet driver map does not prove completion. The private handoff waits for
actual Reader acquisition/finalization, transitive shared calculations, shared
capacity and pins, every renewal already queued before its interval stopped,
response encoding, actual socket finish/close, and capacity finalization.
Unknown outcomes remain owned. A cancelled caller cannot release work still
needed by another route. The runner refuses another load while its predecessor
is unresolved. A bounded observation can return an incomplete result without
abandoning the underlying owner.

Startup races actual ready/error/exit under a fixed deadline. Shutdown requests
graceful completion, then uses bounded signals and observes actual exit when
necessary. Forced exit is explicitly unverified remote settlement. Neither a
child's disappearance nor empty currentOp permits generic reclamation.
Preparation failures also preserve the source/model namespace and write a
private retention receipt. Unknown fixture data is not dropped in a finally
block. The separate early-acquisition deadline improvement from the foundation
audit remains outside this ticket; held early acquisition can be reported
unknown without becoming a successful load.

## Attempt protocol and storage

Explore requests exactly 20 retained attempts; acceptance requests exactly 100.
Each first attempt uses a fresh application process with no same-request response
warmup. This does not claim cold MongoDB or operating-system caches. Later trials
use one fresh process, retain exactly five excluded six-route warmups, and then
retain every required attempt. Failed warmups are not replaced.

The existing summarizer assigns effective `"Infinity"` to failures, mismatches,
timeouts, missing query evidence and incomplete results. Nearest-rank p95 uses
ranks 19 and 95. Both at least 95% full/correct within 15,000 ms and p95 at most
15,000 ms must pass. Expected-negative comparisons have a separate summary;
an exact approved 503 never becomes a successful page sample.

The fixed artifact allowance is 8 MiB, reserved from the fixture's original
32 MiB storage declaration. The Builder therefore receives a lower 24 MiB
storage cap. Other original fixture limits stay fixed, including its 30-second
build budget. The runner bounds input plans to 1 MiB, request bytes to 64 KiB,
each response to 1 MiB, active command keys to 256, errors to 128, telemetry to
256 KiB, and attempt records to 256 KiB. It reserves a complete possible next
six-body capture and terminal evidence before dispatch. Forecast metadata and
worst-case record demand are explicit; a forecast is not a claim that every
possible distinct response can fit. Exhaustion stops the run with a partial
failure instead of larger resources or discarded attempts.

A new output directory contains `manifest.json`, `references.json`, append-only
`attempts.ndjson`, content-addressed full body files and `report.json`. Every
attempt has a durable start entry before dispatch. Body deduplication is report
storage only; timed requests always run. File digests bind the retained evidence.
Final-write failure leaves the prefix and writes a bounded failure receipt; if
the destination is broken, a private temporary receipt records the failure.
Previous report directories are never overwritten.

The complete required family inventory is reported. Known finite scenario
coverage is tied to exact raw fixture bytes, typed request bytes, actual
completed conditions and their independent references. It is labeled partial.
Caller-supplied family names or passing booleans do not establish coverage.
Missing cases remain unverified. The small finite report cannot pass the full
matrix or representative target gate.

## Reproduction and validation

Use the root-owned dedicated loopback fixture server; this tool does not install
or start MongoDB. It never loads `.env`, accepts credentials or a remote target,
exports source data, installs a scheduler, changes resources or deploys code.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' \
  vp exec node scripts/patients-performance/report-loads.cjs explore \
  --output /tmp/patients-load-report-new
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' \
  caffeinate -i -t 600 vp test
vp check
vp run lint
```

`acceptance` selects the 100-attempt protocol. A requested plan that cannot fit
its fixed artifact forecast stays partial and records unexecuted conditions.
It never changes the sample requirement or claims release acceptance. The
focused real-application regression executes 100 retained attempts and five
warmups for one condition. The reproducible explore report covers live and
selected-snapshot first/later conditions, 80 retained attempts plus ten warmups.

The final complete suite passed **120/120 tests in 15 files, 287.99 seconds**,
with no unhandled errors. It includes the focused original disconnect/publication
contract repaired after the first full run passed 119/120 tests in 207.51 seconds.
The focused red reproduced in 21.20 seconds and green passed in 13.87 seconds.
The cancelled caller's own settled pin releases while the shared pin protects its
work; the private load receipt still waits for transitive completion. No test,
budget, timeout or ownership requirement changed.

Only the final static clock/timezone/Mongo-version and product-file hash fields
landed after that complete suite loaded its source. The existing real capture
case then passed in **43.18 seconds**, including 20 first attempts, 20 later
attempts, 100 later acceptance attempts, five excluded warmups per later series,
and the durable startup-failure artifact. The separate integration merger must
run the final committed tree's full suite.

The final explore report records all four live/snapshot first/later conditions:
80 retained loads, ten excluded warmups, 90 durable starts and completions, and
40 distinct fresh first-process incarnations. API p95 values were **354.60,
261.76, 137.32 and 105.66 ms**. Every result remains API evidence on a 15-record
synthetic source, not a page/target claim. All 540 endpoint responses parsed;
actual driver counts settled and each private response receipt bound its real
pinned generation and independently installed fixture capacity policy.

`ticket-34-fixture.json` embeds every exact raw artifact as UTF-8 lines with its
byte length and SHA-256. Concatenating each file's lines reconstructs the original
manifest, references, attempts, report and full response bodies. Its source
inventory hashes all 135 JavaScript/tool files from this worktree. Formatting the
outer fixture does not change those embedded bytes. The raw final report SHA-256
is `c17b7ba5ca50bff5b2f84bdd72bfe298c8517d29b168bcc3b67f60ae299438aa`.
The 13 raw artifacts occupy **665,058 logical bytes**, within the fixed 8 MiB
allowance. The independent source/model fixture was removed only after verified
normal completion. Changed-path `vp check` passed all **14 formatted files / 11 JavaScript files**
with no warnings, lint errors or type errors. Mandatory `vp check` still reports
the same **35 untouched baseline formatting files**. Mandatory `vp run lint`
still fails because ESLint 9.18 has no flat `eslint.config.*`. `git diff --check`
is clean. Earlier failed/red logs remain outside the repository.

## External gates

Actual frontend initiating-action timing, request order, current-six rendering,
errors and visible freshness remain unavailable and deferred. Representative
full source/history, target native/runtime/topology, independently measured
headroom and complete physical peaks are unverified. Actual mutation availability,
cut/acquisition/build/publication, bounded recovery, cleanup and display have not
been measured as one 24-hour chain. Upstream ingestion remains unknown. Every
local report leaves page and visible-freshness gates failed, target capacity
blocked, and Production not accepted. Legacy remains the default selector.
