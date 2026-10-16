# Independent final-fix verification

These are inspection reports, not executed test results. The original two axes describe the frozen 20-path WIP on `fba0a4a5ddac43825bb35e86db33247eda0b7985`, before final formatting, with tracked diff SHA-256 `3cc0589746ec25c4dcd227d80727cdd82efffddf6e44fda97c63df27d46b2c0b`. Their line references and pending-validation statements belong to that checkpoint and have not been relabelled as final-line or full-suite evidence.

The later narrow reports inspect only the collector repair after the preserved 133/134 failed full run. They identify the exact driver/test hashes they inspected. Each reviewer ran no tests or workloads. Subsequent validation results are recorded separately in [final-review-fixes.md](final-review-fixes.md); both first and second full runs failed. The subsequent complete serial run passed 135/135 tests across 19 files in 1192.59s; its actual exit and tested-byte evidence are recorded in the sibling document. Historical pending statements in the primary reports below remain unchanged.

# Standards

Targeted verification of frozen `fba0a4a` + 20-path WIP only. All file hashes and diff SHA-256 `3cc0589746ec25c4dcd227d80727cdd82efffddf6e44fda97c63df27d46b2c0b` match the root checkpoint.

- **S1 resolved by code inspection.** `application.cjs:41–45` gives the child an owned empty `cwd`, satisfying `scripts/patients-performance/README.md:9–10`: “the harness never loads `.env`.” Synchronous fork failures remove it (`69–71`); normal and actual failed-startup exits remove it from the actual child `exit` handler (`77–82`). The synthetic environment and absolute source/module paths remain intact.
- **S2 resolved by code inspection.** `selected-sets.js:9–60` centralizes selected metadata/directory streaming and checks each category’s sealed digest, chunk count, cardinality and explicit empty inventory. Daily fallback (`reader.js:139`), stored fallback (`stored-months.js:205`) and UTC-month/daily selections (`date-months.js:567–570`) call it with their original predicates. All three use the shared chunk-header check; payload decoding stays separate.
- **S3 resolved by code inspection.** `reader.js:360–370` centralizes lookup, the 64-entry limit, work-pin creation, promise registration and consumption. Range/month BSON keys remain distinct (`375–382`, `409–418`), and the existing consumer/shared finalization machinery remains in use.

No additional documented-standard violation or consequential baseline smell was identified in this fix diff. Compact evidence parsing, ledger checks and capacity/deadline ownership changes were inspected only for introduced Standards issues; this does not replace the independent Spec verification.

Implementer-supplied focused evidence records the environment/startup, daily/stored/UTC integrity and shared-registration regressions passing. I ran no tests, workloads or lifecycle actions. Formatting/static checks and the one full suite remain pending; external release gates remain unverified. Original full-branch reports remain unchanged.

**Result:** three original findings resolved; zero new Standards findings.

# Spec

# Targeted Spec verification

**No residual Spec finding established. All five original Spec P1 findings are resolved by code inspection in this frozen fix batch.**

Reviewed `fba0a4a5ddac43825bb35e86db33247eda0b7985` plus the 20 changed/added paths in `/Users/computer/.codex/worktrees/patients-ticket-29/ncd-api`. The tracked diff SHA-256 remains `3cc0589746ec25c4dcd227d80727cdd82efffddf6e44fda97c63df27d46b2c0b`; all six untracked-file hashes match the root stable inventory.

- **Selected-directory integrity:** `selected-sets.js:24–59` streams selected metadata and independent ordered directory tokens, checks each digest/chunk count/cardinality, and verifies empty sets. Daily, stored fallback and UTC-date callers use it (`reader.js:139`, `stored-months.js:205`, `date-months.js:567`) while retaining payload/directory checks.
- **Response deadline and ownership:** `reader.js:625–648` races the whole acquisition/supervision operation. HTTP selection creates and hands through the same fixed deadline; encoding and socket completion remain supervised (`capacity.js:809–923`). Unknown pin/CAS outcomes remain conservative (`control.js:209–221,399–401,470–478`; `capacity.js:567–571,751`). Actual acquisition, queued renewals, shared work and HTTP settlement remain distinct.
- **Live collector gate:** deployment-scope mandatory evidence failures now throw before capacity admission succeeds (`capacity.js:558–559`), blocking preparation and affected new reads through the existing six-route failure boundary. Fixture evidence remains target-blocked.
- **Timing matrix:** the independently installed inventory binds exact scenarios before mutation. Typed wire/context bytes, clock/timezone/reference and actual legacy routing, including mixed loads, are linked to every positive scenario’s explore20/acceptance100 × first/later conditions. Five later warmups are excluded, failed attempts remain Infinity, and ranks19/95 are enforced (`release-series.js:78–136`). Negative comparisons remain separate. Supporting records preserve bounded files/lines/buffers, exact file-header/hash/stat binding, retained backing accounting and reports-volume allocation checks; the manifest and serialized limits are unchanged.
- **Freshness:** fixed run/source/generation/cut/deadline bindings and contiguous event totals account through the later of cleanup/display. Acquisition/build ceilings and one reconciled four-hour reserve reject the original hidden-gap counterexample (`release-evidence.js:356–381`).

No introduced scope creep established. Implementer-supplied focused red/green evidence was inspected; **I ran no tests**. This verifies code changes only, with no new target/page/freshness acceptance. Frontend #32 and existing external gates remain deferred/unverified. Details: `final-fix-spec-verification-details.md`.

Summary: Standards — three original findings resolved, zero new findings. Spec — five original P1 findings resolved, zero residual findings. Inspection only; final full-suite validation remains pending.

# Narrow trace repair: Standards

Narrow Standards delta verification complete: **zero new documented-standard violations or baseline smell findings**.

Inspected only `final-error-evidence-fix.diff` and its frozen `driver-trace.cjs` hunks. Current SHA-256 matches `d2215e0be4fd4eb6128e52f7029a31a438ca7e0526ff763540eb901abba52988`; unchanged `loads.test.js` matches `018be8eaa8db1e48cb895df8517e8dcd858d9b6d430dfc85c0054d3ca976f7a5`.

The two literal command names at `scripts/patients-performance/driver-trace.cjs:27–28` classify actual termination/visibility checks within the existing monitored-command mechanism. The `diagnostic` change at lines 43–54 extracts a genuine MongoDB `Int32` value before the existing safe-integer/string checks. Error-name sanitization and bounded guards remain unchanged. These are focused extensions of existing behavior, without speculative abstraction or duplicated lifecycle logic.

The prior S1/S2/S3 verification remains complete and unchanged. Focused GREEN **15.18 s** is supplied by the implementer; I ran no tests, installs, workloads, lifecycle actions or merges and read no Spec reports. The historical 133/134 full failure remains preserved; full2 has not started and no full-suite pass is claimed.

# Narrow trace repair: Spec

# Narrow Spec verification: trace repair

**Resolved by inspection; no concrete residual or scope creep established.** This reviews only the trace repair following the preserved failed full run, not the previously completed five-fix review.

Requirement: cached #34 line9 requires “sanitized actual database-error evidence; absence of error verification is unknown.” Line10 requires settled dependent work; line11 preserves every failed attempt and Infinity.

- `driver-trace.cjs:26–28` adds only literal `hello` and `getCmdLineOpts`. These match actual independent topology/visibility/termination calls at `lifetime.js:64–65`. They remain real monitored commands with normal start/terminal accounting; this adds no termination shortcut.
- `driver-trace.cjs:43–53` unwraps only `instanceof mongodb.Int32` through `.value`, then applies the existing safe-integer/strict-string validation. It recovers the observed code2 without generic numeric, BSON identity or query coercion. Unknown diagnostics still sanitize names and reject unsupported code representations.
- Unknown commands still become `other` and an `unclassified-command` violation (`89–99`). Existing active/error/byte limits, privacy filtering, HTTP/dependency ownership, pending-command checks and fail-closed evidence seal remain unchanged (`6,76–85,149–241`). No probe tags remain.

Inspected runtime/tool SHA `d2215e0be4fd4eb6128e52f7029a31a438ca7e0526ff763540eb901abba52988`; the public test retains exact SHA `018be8eaa8db1e48cb895df8517e8dcd858d9b6d430dfc85c0054d3ca976f7a5` and its exact code2/privacy/negative-load assertions.

The supplied tuple probe and focused green record support the diagnosis; **I ran no tests or workloads**. The original133/134 failed full result remains historical; no second full pass or external acceptance is claimed.

# Narrow ownership cleanup: checkpoint provenance

These separate reports inspect only the two runtime deltas and added public regression after the second failed full run. They belong to the frozen pre-format six-file checkpoint below, verified independently before and after inspection. Their line references are historical, and neither reviewer executed tests or workloads. The supplied focused result is four passed, twelve skipped, two files, 102.35s, actual exit 0. Both full failures remain preserved; no later full pass is implied.

- `src/modules/patients/read-model/control.js`: `60f0e2243b2a416ef8e2ba56c1f5e8c479fa758caa486c7e0d17c54a8ecd7959`
- `src/modules/patients/read-model/capacity.js`: `cdc32173d872f80e9fbf9801abaeb16af7536c2dcc43b90c1d55921630d8f355`
- `scripts/patients-performance/acquisition.test.js`: `141e879e33223dc7abaf2ac094d227cb36fd65e80213b7cea9c0a6b46c874e0d`
- `scripts/patients-performance/generations.test.js`: `890d334ba9b62cff3262e3ae88720ae2bff8998e9a8d665f5444334b8429799d`
- `scripts/patients-performance/loads.test.js`: `018be8eaa8db1e48cb895df8517e8dcd858d9b6d430dfc85c0054d3ca976f7a5`
- `scripts/patients-performance/driver-trace.cjs`: `d2215e0be4fd4eb6128e52f7029a31a438ca7e0526ff763540eb901abba52988`

# Narrow ownership cleanup: Standards

Narrow ownership-cleanup Standards verification complete: **zero new documented-standard violations or consequential baseline smell findings**.

Inspected only the permanent full2 delta, its added public regression, and necessary caller context. All six supplied file sizes/SHA-256 values matched before and after inspection.

- `src/modules/patients/read-model/control.js:199–207` now evaluates `writeOptions` before the driver-error `try`. Local budget/cancellation rejection therefore avoids the dispatched-CAS error classification. The actual `replaceOne`/await remains inside that catch, retaining conservative unknown-outcome handling and exact transition readback. This is a focused error-boundary correction with a descriptive local name.
- `src/modules/patients/read-model/capacity.js:824–832` creates one cleanup budget inside the existing memoized closing operation, after genuine pending-work settlement and output-allocation release. `owner.finish` still applies actual settlement proof and retains suspect ownership when necessary. The serving deadline and existing limits are unchanged; no speculative lifecycle abstraction or duplicate finalizer was introduced.
- `scripts/patients-performance/acquisition.test.js:162–214` exercises the public Reader with a real held capacity-control read. It checks cancellation, no callback, retained reader ownership before release, and the existing three-second pins/owners cleanup bound after release. Existing generation/load/collector test bytes remain unchanged.

The implementer supplies **4 passed / 12 skipped across 2 files, 102.35 seconds, exit 0**. I ran no tests, installs, workloads, lifecycle actions or merge, and read no Spec reports. Both historical full failures remain preserved; the original full2 interleaving remains unobserved, and no successful new full run is claimed. Prior Standards reports remain unchanged.

# Narrow ownership cleanup: Spec

Code-inspection-only narrow Spec verification of the two permanent runtime deltas and added public regression. No installs, tests, workloads, lifecycle, tracker, or target operations performed. Zero concrete missing/partial requirements, incorrect implementations, or scope-creep residuals found in this delta.

The applicable requirements remain #17:302, “Use a 60s optimized response deadline”; #17:303, “Without proof, keep the pin and model”; #33:10, “Preserve uncertain detached ownership until actual termination proof”; and #34:10, “Cancellation/timeout must not lose ownership of dependent work.” These references are the supplied review-issue-17.md, issue-33.md, and review-issue-34.md.

At control.js:199–222, synchronous write-option preparation precedes the mutation try. A local cancellation before replaceOne no longer acquires an unknown mutation label. Actual driver-call failures still become unknown; only the exact recorded logical transition resolves them. Unknown acquisition retention at reader.js:626–631, capacity coordinationUnknown at capacity.js:751, and conservative settlementProof at capacity.js:567–571 remain intact.

At capacity.js:824–836, memoized closing creates exactly one 60000ms cleanup coordination budget after actual pending encoding settles and output allocations release. owner.finish still awaits its sequence and recomputes conservative proof (758–779); unsafe ownership remains suspect. The original HTTP budget/timer and 503 path (810–823, 898–906) remain fixed. This does not restart serving time or alter the 12/2/6/4 ledger.

acquisition.test.js:162–214 exercises public Reader with real Mongo wire transport: cancellation while the capacity-admission read reply is held, callback exclusion, retained reader pin before release, then original 3s pin/owner cleanup. Existing committed pin/capacity guards (20–101), 60s HTTP/62s assertion (103–160), lost-write readback (generations.test.js:392–426), and held shared-work cleanup exclusion/10s polling (536–574, 40–45) are unchanged. loads.test.js:435–486 still checks transitive six-route settlement.

All six frozen SHA-256 values matched both supplied inventories before and after inspection. Supplied focused evidence reports 4 passed/12 skipped, 2 files, 102.35s, actual exit 0; I did not execute it. Preserved full1/full2 remain failed, each 133/134 (1184.39s/1196.08s). The original full2 interleaving remains unobserved; no environmental attribution, failure waiver, or new full pass follows. Actual source/history, resources/full workload, native/target, page/freshness and deferred frontend gates remain unverified/open under #34:5 and #35:5,17.
