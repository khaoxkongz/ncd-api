# Ticket 33: backend capacity accounting

Implements the backend scope of [issue 33](https://github.com/khaoxkongz/ncd-api/issues/33) against integration
`06d8b118ec9d5c368d2bbd69464e76d350f96714`. Public boundaries remain Builder, Reader and the existing six controllers.
Legacy remains the deployment default. Functional fixture success does not pass capacity or activation acceptance.
The original external gates in issues 29, 30 and 31 remain open; frontend work is deferred in issue 32.

## Policy and evidence

Reader and Builder accept capacity configuration only through trusted process composition. A bounded signed BSON policy
does not carry its own trust key. The installed operator trust record separately binds its public key, authorized
deployment IDs and scope. A fixture authority cannot authorize a deployment by relabeling its evidence. Source-producer
keys cannot authorize capacity policy.

Applicability binds deployment revision, actual Node/platform/architecture, driver/codec, database, full source digest,
source version, supported history/domain, process IDs and process incarnations. The topology identifies API and Builder
roles, their resource domains, database placement and source/database/log/temporary volumes. Every applicable host/service
requires RAM and CPU definitions; volumes require disk; controlling IO metrics require exact units and windows. Evidence
includes its reference, digest and covered interval. Validity is an explicit operator revision or time window; there is
no invented universal evidence TTL.

For each applicable domain, `H = min(allocation, totalLimit) - existingPeak - reservations`. Existing peaks must be
representative operator evidence. Instantaneous free RAM, a filesystem sample, configured requests and laptop resources
do not establish H. Derived limits are fixed in the policy identity:

| Resource                                     | Additional allowance                         |
| -------------------------------------------- | -------------------------------------------- |
| All API processes                            | `min(256 MiB, H / 4)`                        |
| Builder                                      | `min(512 MiB, H / 4)`                        |
| Database                                     | `H / 4`                                      |
| Shared host/service API + Builder + database | `3H / 4`                                     |
| Disk                                         | `4H / 5`, preserving at least one fifth of H |
| CPU and each controlling IO metric           | `H / 2` in the declared units/window         |

The original per-response 128 MiB, combined serialized 8 MiB, complete BSON chunk 1 MiB, payload 960 KiB, two slots and
one heavy operation remain enforced. Lower declared or derived limits win. No retry raises a limit.

Observation packets need a separately installed collector key, matching scope/policy, approved mechanism and approved
maximum observation gap/lag. Coverage is checked against the actual request/checkpoint time; future coverage is rejected.
An arbitrary `complete-peak` string is insufficient. Missing applicable RAM, role/DB RAM, disk, CPU or IO observations fail
acceptance. Signed synthetic guard stimuli exercise rejection but remain explicitly nonrepresentative. Complete applicable
deployment evidence can be evaluated; fixture scope always leaves target acceptance blocked.

Trusted Builder-role observations must also fit the original lower declared Builder budget, even if the derived policy
cap is larger. A RAM observation needs a separate `response` record with additional bytes, byte units, complete-peak
coverage, an evidence reference and isolated-response attribution from that approved collector. Whole-process or aggregate
API RAM cannot substitute for the response's 128 MiB bound. Missing response attribution is explicitly unavailable.

Collector calls use the original operation deadline and receive an AbortSignal. An overdue call fails the operation; a
collector that remains unsettled retains its durable owner and prevents slot reuse. An abort request does not prove the
collector ended. Admission commits before the collector runs.

## Ownership and measurement

Admission uses the existing bounded control-document CAS across actual processes. Initial workspaces are small enough for
ordinary six-route concurrency. Workspace growth and serialized windows commit before dispatch or known allocation.
An owner reuses bounded local subleases inside its admitted serialized window, rather than writing the coordinator twice
for every cursor row. A new dispatch must fit the remaining window or grow it first. Workspace/window reservations are
separate from observed retained buffers.

Known buffers charge their entire unique ArrayBuffer backing, including pooled slabs. Shared physical backing is counted
once locally; each response includes the cost of the shared owner on which it depends. Returned cursor arrays accumulate
ownership before the next dispatch and release at the end of actual use. Streamed rows release after their consumer
advances. Unknown dispatched work keeps its owner and reservation; timeout, socket closure, cursor close acknowledgement
or lease expiry alone does not reclaim it. Supported Worker reclamation uses ticket 28's genuine checkpoint/exit/database
proof and the same guarded transition.

JSON encoding and socket output remain charged after Reader returns. Encoding reserves its known upper bound first and
uses an exact unpooled buffer, avoiding the actual Node runtime's 64 KiB pool backing for tiny bodies. Ownership ends only
after encoding settles and the response finishes or closes. Guard failures retain the approved 503 contract.

Decoded heap and native bitmap costs use conservative reservations, not measured physical peaks or compression claims.
Process RSS/heap/external/native observations overlap and include all roles and Worker threads in that process. They are
diagnostics with actual process incarnation, baseline, attempt and sample interval. They are not summed as independent
physical totals or attributed as a fresh response's isolated additional RAM. Recovery preserves predecessor observations
and failure history; an old absolute RSS value is never subtracted from another actor's baseline. Unsupported physical
peak attribution remains unavailable and fails target acceptance.

`peakSerializedBytes` is the largest single scratch estimate; `peakNativeReservationBytes` is the largest single bitmap
growth reservation. Aggregate admitted workspace/window and sampled unique retained backing appear under
`capacity.ownershipPeaks`. These fields do not establish complete physical peaks.

Compatible recovery currently requires the exact frozen process inventory. The verified Worker replacement keeps the
same containing process incarnation and separate attempt observations. A replacement OS process needs a new independently
signed inventory; that changes the capacity policy identity and is rejected for the original run. Generic process-crash
rebinding is unsupported. New Reader/load sessions can receive their legitimate actual actor inventory without claiming
that an old Builder run has been rebound. A failed attempt whose observations cannot be durably saved retains its fence
and cannot resume from an older checkpoint. Failure bookkeeping preserves the original stage error.

## Finite cardinality and storage ledger

The ledger records actual raw count, maximum BSON, observed date bounds, Mongo patient/hospital identity classes, complete
hospital-days, typed geography partitions and expanded/deduplicated/non-array membership counts for all 15 categories.
Output records dictionary classes, daily Card/hospital/category memberships, partitions, payload lengths, chunk counts and
popcounts. Checkpoints retain these facts only with their verified input/output group.

Storage observations include all shared model collections and indexes, control, recovery journals, refresh ledgers, every
failed staging prefix and known retained source files. Source files are deduplicated by physical file identity and remain
producer-owned until independent deletion proof. Shared collection allocation is counted once; per-generation BSON and
layout totals are logical attribution, not another physical allocation. Different-sized active and candidate generations
are reported separately. DB transient memory, aggregation/index scratch, journal/log/temp-volume peaks and representative
CPU/controlling IO remain unavailable. Stage samples do not replace those peaks.

Source metadata records logical file length and supported allocated filesystem blocks separately, using exact device/inode
identity. Retained source cost reserves the larger of those measurements. Missing allocated-block support remains explicitly
unavailable; it is not reported as zero. Allocated file blocks still do not establish whole-volume/transient peaks. The
existing public finite-ledger case observed red/green for this distinction and passed in 12.38 seconds.

Known source backings also have an independent durable ledger in the bounded control document. Generation cleanup and a
new policy do not remove those charges. It keeps conservative file high-water values, deduplicates the actual host/device/
inode identity and charges its own control allocation. The ledger permits 64 known backings; overflow rejects further
admission. There is no automatic expiry or source-deletion assertion. The public ledger regression observed loss of an old
source after cleanup, then passed with both source charges retained through cleanup and a separately trusted new policy
in 19.60 seconds. Actual deletion/reclamation of producer-owned exports still needs an independently supported procedure.

## Reproduction and observed failures

[The bounded report](ticket-33-fixture.json) runs archived baseline ETL/controllers and the actual candidate controllers
against real isolated MongoDB. Both complete sources cover 2023-12-31 through 2025-01-08 and exercise all 15 categories.
The first has 15 records; the second has 14 and different complete outputs. It compares full-history and snapshot bodies
on all six routes for both cuts, serves the previous whole six-route output during full refresh, then attempts a larger
15-record distinguishable full-history source twice under the same one-byte storage cap. Each rejection must preserve all
six entire previous bodies, statuses and actual source/state headers. Retry retains the same run/generation/policy, fixed
budgets, build start and original 12/2/6/4 ledger. Cleanup is verified and idempotent. No historical 252-comparison report is
silently substituted for this run.

Eighteen capacity integration cases additionally cover missing/untrusted/inapplicable evidence, complete domain
requirements, signed guard stimuli, shared per-response admission, three actual API child processes, detached held Mongo
work, finite ledger sizes, changed policy rejection and actual Worker-attempt recovery. These use public Reader/Builder,
real Mongo wire barriers and the existing controllers; no test HTTP surface or repository-method mock is introduced.

Observed red/green work included absent policy falsely implying acceptance; omitted CPU/IO applicability; unverified peak
labels; three-process aggregate admission; shared work excluded from a dependent's response; ledger omissions; mutated
journal snapshots; lost post-checkpoint failure observations; and pooled JSON buffers exceeding their admitted backing.
The full-history report also exposed idle cursor dispatch credits and finished dictionary lookup arrays retained too long,
then per-row CAS overhead hitting the original 30-second build budget. Bounded owner windows and explicit lookup lifetime
resolved these without raising limits or reducing input/history/categories. Raw failed attempts remain in the completion
record alongside passing runs.

The first full-suite attempt recorded 89/111 passing, 22 failures, eight uncaught errors and 2008.04 seconds. The host
entered recorded 715-, 931- and 185-second sleep periods during that attempt. This is a failed run, not passing evidence.
It also exposed a real synchronous budget exception escaping the heartbeat's Promise catch; admission errors now reject
through the tracked operation before dispatch. A corruption wire barrier had intercepted a newly added projected storage
inventory before daily data existed. It now targets the actual unprojected Reader descriptor; the same corruption and
recovery expectations passed in 9.62 seconds. A pending collector also supplied an observed red/green deadline and retained
ownership case; a real Mongo journal validator supplied the failed-observation persistence/recovery rejection case. Two
verified orphan fixture child processes were terminated and actual exit
observed. No process disappearance was used as proof to reclaim unrelated model ownership.

A later full run passed 112/113 cases and exposed settlement metadata using the live-lease guard. An expired lease still
blocks new data work; the unchanged owner/run/fence can now persist an actually settled failure. Its existing held-command
cleanup regression passed in 9.08 seconds. Separate signed 200 MiB guard stimuli then demonstrated rejection under the
original 128 MiB Builder cap despite the 512 MiB derived cap, and the 128 MiB response cap despite a 256 MiB aggregate cap.

## Validation and outstanding gates

The final suite passed all 115 tests in 14 files in 182.44 seconds. The final report passed in 28.59 seconds, with full
build phases of 15.31 and 10.72 seconds under their unchanged 30-second limits. Largest sampled retained backing was
262,144 bytes; the admitted serialized-window maximum recorded by each build was 1,245,184 bytes. Sampled accounted
storage maxima were 1,486,848 and 1,441,792 bytes. These remain retained samples/reservations, not complete physical peaks.
Final control measured 3,222 BSON bytes with Int64 fields preserved: one occupied slot, zero pins, zero capacity owners
and three independently retained source backings. Producer-owned sources are not claimed deleted by model cleanup.

Changed-path checks pass for all 23 formatted files and 21 JavaScript files with no lint/type warnings or errors. Full
project `vp check` retains the same 35 untouched formatting failures. `vp run lint` retains ESLint 9.18.0's missing
`eslint.config.*` failure; neither is reported as passing. `git diff --check` is clean, and merging the integration branch
was already up to date. Install had already completed at this integration base; dependencies and the lockfile did not change.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-capacity.cjs > docs/patients-read-model/ticket-33-fixture.json
vp check <changed source, fixture, report and documentation paths>
vp check
vp run lint
git diff --check
```

Local runtime is Node 24.22.0, MongoDB 7.0.9, driver 6.10.0, roaring 2.7.0, Vite+ 1.1.0 and Vitest 5.0.3 on Darwin arm64.
Fixture limits remain 30 seconds original Builder time, 8 MiB source, 32 MiB storage, 128 MiB admitted additional Builder
workspace, 8 MiB combined serialized, 1 MiB chunks, 960 KiB payload and one heavy operation. Task-local idle-sleep prevention
around validation does not change these limits or global system settings.

Representative target headroom/quotas, full process/DB/volume topology and collector evidence, complete source/history
capability, target Linux amd64 native compatibility, authorized concurrent full-workload results, actual ingestion and
cadence/termination/failover capability, and real frontend/page freshness/error/performance evidence remain required. The
existing short UAT observations do not meet these gates. No UAT/Production workload, export, deployment, scheduler,
resource change, paid service or external message was performed. The read-only source boundary and $0 cap remain.
