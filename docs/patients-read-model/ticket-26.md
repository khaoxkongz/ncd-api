# Ticket #26: bounded publication and safe generation lifetime

Implements the backend control protocol in [#26](https://github.com/khaoxkongz/ncd-api/issues/26) under [#17](https://github.com/khaoxkongz/ncd-api/issues/17). The ticket branch merged the completed #24/#25 prerequisites at integration `08a112a678a5dff677af9e9c97b34c970ab77c37` in `2e00aae75dd777f278029153a32387a7c13e60dd` before implementation. Prepared scopes, source-collated indexes, stored-month and UTC-date families, snapshot provenance and both arithmetic policies remain intact.

The deployment default remains legacy. Public `NCD_PATIENTS_BACKEND=read-model` selection still returns the approved unavailable response until the later release gates pass. Full publication and reads are exercised through the existing private process-side validation context and existing six HTTP controllers. There is no new endpoint or request activation flag. The user deferred dashboard work to [#32](https://github.com/khaoxkongz/ncd-api/issues/32); actual rendering, page request behavior and frontend error/freshness acceptance have not passed here.

## Control and publication

The Builder now owns `publish(candidate, expectedActive)`, `cleanup(generationId?)` and explicit `rollback(generationId | "legacy", expectedActive)`. Reader callers retain the callback interface. Control, cursor tracking, shared-work ownership and deletion transitions stay behind these interfaces.

One `patients_model_control` document contains two fixed slots, the active pointer, one fenced Builder descriptor, at most 64 pins and a bounded transition history. Nonnegative signed Int64 counters distinguish control revision, publication version and Builder fence. Pin acquisition, renewals and release advance revision without changing publication version. Both the stored document and each proposed atomic replacement must fit within 1 MiB; exhausted counters and invalid/overflowing control fail explicitly. Control transitions use primary reads and majority conditional writes. Logical operation IDs and readback resolve uncertain writes; the publication result also remains in its occupied slot so retry does not republish after the short transition history rotates.

A managed build claims a free slot and a unique owner/run/fence before the full source transport hash scan and heavy source staging. Every stage checks ownership and lease. An expired Builder still owns its work until actual settlement; expiry cannot authorize a competing heavy build. A full raw build must pass the existing source contract, all fourteen compatible component inventories, schema/dictionary/codec/arithmetic identities, stored/date/prepared set checks, Card/Bar differential checks and six endpoint snapshot checks. Before ready, it stores an immutable BSON descriptor digest and count/digest inventory of every generation data collection. Publication rechecks descriptor and contents, expected active identity/version and the fenced ready slot. Failed, partial, changed, stale and comparison-only candidates cannot publish.

Historical BSON comparison fixtures explicitly declare `comparisonOnly: true`; they remain incomplete and unpublished. That offline seam rejects work when managed control exists. Explicit generation selection cannot bypass managed active selection, except for validation owned by the live building claim. A failed or deleting slot remains occupied. A third candidate is rejected until a slot is actually free.

## Ownership, cancellation and cleanup

The Reader conditionally pins the same active generation and publication version before reading its descriptor or data. If publication wins that condition, it selects again within the request budget. Publication preserves existing pins. Shared range or month work atomically forks an independent pin from a live protected parent before dispatch; this also permits a protected old caller to start dependent work after its generation retires. Arbitrary retired/deleting acquisition is rejected. Exact BSON query bytes and generation/version/context continue to govern sharing.

Each caller has its own demand. A disconnected caller stops waiting and stops dispatching caller work, while another caller can keep the shared calculation alive. With no remaining demand, the calculation stops dispatching new work but retains ownership until its actual operations settle. Existing request abort and response-close events feed the private Reader context. Callback tasks and lazy expense iterators cannot escape their lifetime: an early callback return waits for already-started tasks, and a later fact/iterator call fails.

The 60-second response budget and positive remaining-time database budgets remain unchanged. Heartbeats run every 15 seconds and leases last 120 seconds. A response deadline, rejected promise, cursor close, kill acknowledgement, worker exit or expired lease is not treated as server termination. The supervisor tracks real promises and cursors, tags commands/getMore with worker/pin/generation ownership and releases only after actual application settlement plus confirmed normal exhaustion, or supported independent database observation. The local no-auth standalone observer checks executing and idle cursor operations through all-user `$currentOp` after application quiescence. Replica-set, sharded, authorization or visibility uncertainty retains suspect protection. No caller can supply a boolean claiming termination.

Cleanup first conditionally marks an inactive settled slot deleting while requiring no reader/work pins or Builder ownership. It then removes and verifies all generation documents and exact generation staging collections before freeing the slot. Failure between deletion and verification leaves the deleting slot occupied for retry. Expired pins become suspect and continue to block cleanup and reuse. Unknown orphan/Builder outcomes are intentionally retained; automatic takeover or orphan release without supported topology/termination evidence is not implemented. This conservative outcome fails cleanup/freshness acceptance within the reserve; it is not a successful recovery claim.

Explicit rollback checks sealed compatible retained output and the expected current publication. It can select the retained previous full generation. `rollback("legacy", expectedActive)` atomically clears the managed active pointer; the operator uses the existing explicit legacy backend configuration, which is also the current public default. It rejects deleting/deleted output. Every response stays with its initial full generation and actual view source metadata; no response switches models or falls back mid-read.

## Tests and evidence

Thirteen new integration tests use actual UUID MongoDB databases, Reader/Builder and existing HTTP controllers. A bounded loopback wire forwarder holds or loses actual MongoDB replies without replacing model methods. A real Node Worker is terminated while it owns a Reader lifetime. Tests cover:

- Full checked ready/publication and six endpoint output, immutable descriptor/content rejection and managed selection bypass rejection.
- HTTP disconnect with surviving shared demand; all demand cancelled with outstanding replies; callback and lazy iterator ownership; unawaited real Mongo work.
- Worker exit followed by lease expiry retaining a suspect pin, blocked cleanup and blocked third candidate.
- 64 held concurrent pins, the 65th rejection, proposed control byte overflow, counter exhaustion returning the exact six-route 503, invalid/expired request budgets and publication independent of pin bookkeeping.
- Lost publication and pin write replies with readback, stale expected-active/fencing rejection and retained/legacy rollback.
- Publication after active selection but before pinning; old pinned range/month/snapshot work after retirement; cleanup and third-slot guards; interrupted deletion followed by verified retry.

Observed red/green fixes included the original incomplete publication tracer; missing real HTTP disconnect propagation; unsafe cancelled shared-entry reuse; early callback return before unawaited work settled; handled MongoDB error cursors being retained because the independent observer used the wrong driver aggregation entry point; and a competing Builder reaching source validation before the global fence. The observer now runs through the actual admin database aggregation API and the original BSON fixtures pass. A real server error response distinguishes a settled server error from driver/runtime/client-close errors, which retain uncertainty until independently observed.

The first full combined run passed 65 of 66 tests. The 64-pin fixture launched and released all 64 CAS loops simultaneously; under the parallel suite it hit the existing process RSS budget after 12.8 seconds. It was changed to stagger arrival and release while retaining 64 genuinely overlapping held pins and checking rejection of pin 65. The request RSS limit remains 128 MiB and the time limit remains 60 seconds. Process RSS includes the surrounding test context; this test establishes a cardinality boundary, not 64-request burst throughput, aggregate capacity or target headroom. No production limit was enlarged.

[The repeatable sanitized report](ticket-26-fixture.json) captures six complete old responses, six concurrent responses held across publication, six complete new responses and verified removal of the retired generation. Each concurrent body and header set is compared with its complete old or new reference. This observed run returned all six old responses across publication and all six new responses on the following page request; separate page calls are allowed to span full generations. The old source cut is 2024-01-09 05:00 UTC and remains stale at the captured 2024-01-11 clock; the new source cut is 2024-01-10 00:00 UTC and is fresh at the exact 24-hour boundary. The synthetic raw cuts contain ten and eleven records. Final observed control revision is 162, publication version 2, fence 2, with 3,069 BSON bytes, one occupied slot and no pins. The report's local parsed-body timings and sampled resources are observations, not p95/page-rendering or capacity proof.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-generations.cjs > docs/patients-read-model/ticket-26-fixture.json
vp fmt docs/patients-read-model/ticket-26-fixture.json
vp check <changed source, fixture harness and report paths>
vp check
vp run lint
git diff --check
```

The final combined run passed all 66 tests in eleven files in 132.60 seconds, after the source-fence and conservative error-proof changes. `vp install` succeeded with existing pinned dependencies and script approval; only its two incidental root package-name lockfile fields were restored. The changed source/harness/report check passed with 63 formatted files and no warnings, lint errors or type errors in 59 files. Full project checks retain the 35 untouched baseline formatting failures and ESLint 9.18.0 missing-flat-config failure. `git diff --check` passed.

## Limits and remaining gates

Actual local runtime is Node 24.22.0, MongoDB driver 6.10.0, MongoDB 7.0.9, roaring 2.7.0, Vite+ 1.1.0 and Vitest 5.0.3 on Darwin arm64. All writes, faults and cleanup use isolated explicit loopback UUID fixtures. No Production/UAT source write or export, scheduler installation, spending, deployment or external message occurred; the $0 cap and read-only source boundaries remain.

Full workload/immutable source coverage, representative refresh and concurrent serving headroom, target Linux amd64 native compatibility, target topology/authorization and termination/failover proof, recovery/refresh/freshness SLAs and actual dashboard evidence in #32 remain release gates. Local standalone observation is not replica-set failover proof. Operator current-usage samples do not establish peak headroom or a complete representative observation window. Later #27/#28 work must preserve retained protection and must not translate expiry or unverified termination into successful cleanup.
