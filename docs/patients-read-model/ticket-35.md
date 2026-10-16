# Backend release preparation and rollback (#35)

This ticket implements the backend code slice of #31. Legacy remains the deployment default. No target activation,
deployment, source export, scheduler installation, resource change or spending occurred. The actual source, target
capacity/native/topology, full workload, page, visible freshness and operational release gates remain unmet. Frontend #32
is deferred by the user. Parents #29–31 remain open.

## Startup and selection

`src/modules/patients/backend.js` captures one backend mode for all six existing controllers. Changing an environment value
or supplying a request field/header cannot switch it. `src/index.js` calls `initializePatientsBackend()` before listening.
Legacy initialization imports no release evaluator, source adapter or native codec. The existing app remains importable
without starting a listener.

`initializePatientsBackend({mode, db, capacity, release})` is a process-side composition operation. Explicit read-model mode
prepares trusted evidence outside serving, then installs one immutable runtime. Missing, invalid, expired, revoked or
incompatible evidence installs an unavailable read-model selection. All six return exactly HTTP 503 with
`{"status":false,"message":"Read model unavailable"}`. They do not read legacy data as a fallback.

The shared selector retains the actual Reader and policy selected by each response. Reader requires an opaque prepared
authority, a normal guarded active pin, its exact publication version and descriptor seal, and a full compatible descriptor.
It checks these before derived data. A partial comparison fixture or a caller `validated` flag cannot create authority.
Each new publication needs its own exact approval; A approval cannot authorize B. An already pinned A response may finish
while B publishes or a new process selection is installed.

Ticket 34's acquisition, queued renewal, shared completion, response encoding/socket and capacity-finalization receipts are
preserved. Own settled pins release independently of separately owned shared work. A deadline, socket close, child exit or
quiet command map does not prove remote termination. The separate foundation acquisition-deadline review remains outside
this ticket.

## Installed trust and files

The callable composition interface accepts explicit normal Mongo and capacity adapters. A deployment may instead set
`NCD_PATIENTS_RELEASE_CONFIG` to an independently installed local JSON configuration. It contains the release `policy`,
an `evidence` pair of `manifestFile`/`signatureFile`, and an optional installed `capacity` configuration. All referenced files
are regular local files in the same directory. Filenames cannot traverse directories or fetch URLs; symlinks are rejected.

The capacity configuration uses the existing #33 `binding`, actual `processId`, independently installed `trustedOperators`
and `trustedCollectors`, plus its signed policy file pair. Optional `observation` files supply the latest independently
signed collector record. The reader does not modify collector timestamps, signatures or coverage. Actual deployment
authorization requires a live observer; absent, expired or incompatible observations remain failures. No collector, source
export or scheduler is installed here.

Bounds are 64 KiB for installed JSON and each signed capacity/collector manifest, 64 bytes per Ed25519 signature, and
512 KiB for the release manifest. Preparation admits a 16 MiB workspace and a 2 MiB serialized metadata window through
the existing durable all-process capacity coordinator before parsing release evidence or scanning contents. Product files
are streamed one at a time into a bounded hash inventory. The original aggregate 8 MiB serialized limit and quantitative
resource ceilings still apply. Preparation has one 60-second work deadline, including admission; late work remains owned
until genuine settlement. Only small exact authorization subjects remain in the installed runtime.

The release policy is `patients-release-policy-v1`. It names an explicit nonempty revision, scope, exact observed process /
runtime / database connection / product-byte / lockfile / timezone subject, reviewer identity and public key, exact
`reviewedSha256`, validity rule and revocation digest list. `release-review` authorities also need explicit scope, deployment
IDs and all required gate roles. Source-producer authority grants no unrelated release role. The evidence does not contain
or install its own trust anchor.

Validity is either an exact installed revision or an explicit actual wall-clock window. No universal TTL is invented or
renewed by restart. This version supports the explicit `pinned-completion` in-flight rule. Unsupported validity/revocation
rules reject preparation. Operators install a new reviewed policy/revocation revision through the same process-side
operation; new requests then use that selection. The exact process incarnation requirement from #33 still applies: a new OS
process needs a newly signed inventory/policy and cannot silently rebind an old Builder run.

## Recognized deployment evidence

`patients-release-evidence-v1` is a bounded, signed review record with `scope`, `origin`, exact subject, deployment/config /
frontend/reference identities, one exact sealed descriptor and allowed publication versions, and the nine gate records
below. Each gate uses `patients-release-<name>-v1`, an exact supporting artifact SHA-256, explicit empty `failures` and
`unverified` lists, and concrete `observations`. The independently installed reviewer attests these observations after
reviewing the retained supporting bytes. A digest identifies reviewed bytes; a bare digest, URL, passing flag or untrusted
signature cannot attest their claims. Operators must retain the supporting raw evidence for review.

Only `operator-observations` origin with deployment-scoped installed authority may authorize a target. Synthetic protocol
stimuli use fixture scope and origin, on UUID `patients_contract_*` databases only. They exercise these same schemas but
always report target activation blocked and gate states `schema-exercised-only`. The simpler fixture protocol manifest
also keeps every target gate unverified. Editing a fixture label cannot make either into deployment evidence.

| Gate            | Required observations and binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`        | Each exact full immutable raw hash/version, transport hash, records, domain, all supported history, availability and measured upstream delay. Descriptor source and content inventories are verified against actual retained data.                                                                                                                                                                                                                                                                                            |
| `correctness`   | Accepted baseline `0a1934d…`, stable repeated reference digest, exact source and all 24 required families, typed request hashes, calculation clocks/timezones, and six exact expected/actual status/body/header digests. The comparison policy names only the accepted expense, 503 and metadata exceptions.                                                                                                                                                                                                                  |
| `native`        | Actual Node/platform/architecture/driver/codec, Mongo version/topology, installed process inventory, the portable two-container golden bytes, and registered-Worker plus independent database termination evidence.                                                                                                                                                                                                                                                                                                           |
| `capacity`      | Exact #33 policy and resource domains, complete peaks and isolated-response attribution, physical sharing, all controlling CPU/IO units/windows, all retained/staging/index/spill/log/retry/control/report purposes, and concurrent serving/refresh/recovery. Recompute H and original fractions/ceilings; never enlarge sealed original Builder/serialized/chunk/payload declarations.                                                                                                                                       |
| `full-workload` | Exact source/domain/history, all fifteen categories, typed identities, hospital-days, historical geography, partitions/scopes, both month families, dictionary/index/bitmap and largest partition/union sizes, two different occupied generation sizes, and all 24 families.                                                                                                                                                                                                                                                  |
| `page`          | Exact frontend/reference, fixed calculation clock and actual server timezone, complete first/later conditions, 100 retained attempts each, no first warmup, five excluded later warmups, fresh first sessions and one later session. Link six rendered body/header hashes to exact independent references; require actual full-JSON API and current-six render events plus balanced driver/dependency proof. Failed/mismatched loads remain Infinity; both API and page rank-95 and at least 95/100 must be within 15,000 ms. |
| `freshness`     | Exact mutation availability / cut / export / acquisition / build / publication / read / cleanup / display chain. Enforce cuts <=12h, acquisition <=2h, build <=6h, one combined coordination/cleanup/recovery reserve <=4h and visible delay <=24h. Same-cut/run recovery and genuine termination proof remain necessary.                                                                                                                                                                                                     |
| `frontend`      | Exact frontend revision and observed source time, stale/unknown, explicit 503 without current zeros, rapid-filter races and atomic current-six replacement. Headers alone cannot pass.                                                                                                                                                                                                                                                                                                                                        |
| `operations`    | Exact deployment and process inventory, 11:00/23:00 Asia/Bangkok jobs, original 12/2/6/4 ledger, one builder/heavy operation, two slots, bounded pins/control/request deadline, all-six mode/failure and retained/legacy rollback/deletion-exclusion demonstrations, and concrete handoffs.                                                                                                                                                                                                                                   |

The consumer verifies these recognized observations; it does not manufacture their producers. Current #33/#34 fixture
reports explicitly fail target capacity/page/full-matrix/freshness/native/source gates and cannot satisfy them. There are
no real operator release records in this repository. Actual external authority, collection mechanisms, applicability and
complete supporting evidence must be supplied under later authorization.

## Publication and rollback

Prepare the candidate's exact review outside serving while its full ready slot still exists, then use the original guarded
Builder publication. The descriptor authorization names exact permitted publication versions. A preparation/publication
race is checked again against each actual guarded pin. If B is published without its own authority, new B reads fail 503;
pinned A can complete. No per-endpoint flags or mid-response fallback are added.

The supported explicit process-side sequence is:

```js
const candidate = await builder.build(sourceCut, declaredBudget, { ...comparisonContext, comparisonOnly: false });
const prepared = await prepareRelease({ db, capacity, policy, evidence });
if (!prepared.runtime) throw new Error("Release preparation rejected");
const active = await builder.publish(candidate, expectedActive);
// Install in each enumerated API process with its own actual actor/capacity
// inventory and reviewed exact active identity; preparation is repeated there.
await initializePatientsBackend({ mode: "read-model", db, capacity, release: { policy, evidence } });
```

`prepareRelease` is exported by `src/modules/patients/read-model/release.js`; the initializer is exported by the shared
backend module. The review must name the candidate's real seal/source and the publication version expected from the guarded
`expectedActive` transition. Each API process needs independently installed trust and its own exact process subject. The
preparation runtime is opaque: do not transfer it as JSON or accept a request-supplied replacement. If publication races or
the identity differs, preparation/serving rejects; do not relabel evidence to fit.

The existing callable `Builder.refresh` still builds and publishes its checked candidate automatically. It has no
release-preparation hook. Operators who require B approval before publication must compose the explicit sequence above in
their job adapter. Running the current automatic refresh without that composition can publish unapproved B; the serving
gate then returns 503 for new B reads. This operational gap is explicit. No scheduler/job has been installed or demonstrated
as integrating release approval, and no target-wide installation is claimed.

`rollbackPatientsBackend({target, expectedActive, builder, db, capacity, release})` prepares exact retained contents and
approval, verifies the next publication identity before the existing Builder CAS, then installs the runtime only after the
matching result. A deleted/deleting/incompatible target or a stale expected active identity rejects. Failed preparation/CAS
does not switch the process selection. A lost result remains unverified; do not infer success or reclaim ownership.

`target: "legacy"` explicitly changes the shared six-route selection without needing source/native initialization. It does
not merely clear an active pointer. Existing optimized work retains its original runtime and ownership through settlement.
No retention beyond the compatible immediately previous full slot is promised. Multiple API processes require the real
process manager to install one exact reviewed mode/config/policy revision and drain/restart consistently. A local selector
change is not a target-wide rollback demonstration.

## Operator handoffs

| Owner                      | Concrete input/action still required                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source producer            | Full producer-sealed BSON `sourceCut` and independent producer key; immutable content/transport/domain/history/availability and upstream ingestion proof. `openSource` does not make a live mutable collection immutable. No export has been started.                                                                                                                    |
| Job owner                  | Call `Builder.refresh({cutAt, expectedActive, acquire}, declaredBudget, comparisonContext)` with the actual immutable acquire adapter and original ledger. Schedule 11:00/23:00 Bangkok only after separate authorization. Prepare candidate-specific release evidence before publication; preserve same-cut/run recovery and one combined reserve.                      |
| Recovery/supervision owner | Enumerated actual API/builder/Worker/database process identities, target privileges/topology, registered Worker plus independently observed database completion and uncertain-reply procedure. Keep suspect pins/slots when proof is absent. Generic OS-process replacement is not supported by the existing recovery policy.                                            |
| Resource owner             | Actual H/quotas/reservations/representative peaks, complete source/workload/cardinality ledger, response attribution and CPU/IO/DB/volume/log/scratch observations. Install actual trusted capacity/collector policies and their live signed observation channel; do not substitute current free memory.                                                                 |
| Frontend owner             | Actual repository/revision and #32 implementation; source/error metadata consumer, current-six atomic render, filter races and real page/visible-freshness/failure/rollback observations. This remains deferred, not waived.                                                                                                                                             |
| Deployment owner           | Actual deployment/config/native/runtime/server/driver/process manager, independently installed reviewer/trust/validity/revocation and exact reviewed artifacts. First inspect preparation; install the shared selection consistently only after all original gates and separate deployment authorization. Demonstrate both retained and shared-selector legacy rollback. |

Legacy invocation remains `NCD_PATIENTS_BACKEND=legacy vp run start`. The optional explicit read-model configuration uses
`NCD_PATIENTS_BACKEND=read-model NCD_PATIENTS_RELEASE_CONFIG=/operator/installed.json vp run start`. This is a handoff
example, not an instruction to deploy or a claim that the required files exist. Keep secret paths/keys and private evidence
outside Git. The $0 additional-spending cap and existing source permissions remain unchanged.

## Local verification

The public tests exercise actual app startup, all six controllers, Reader/Builder, real process IPC and Mongo wire holds.
They cover fixture/nontransferable deployment-schema consumption, invalid trust/gates, original lower budgets, exact
reference-linked page failures, policy expiry, descriptor corruption, stale source metadata, A/B publication, pinned old
responses and retained/deleted/legacy rollback. Final counts and commands are recorded in the completion handoff.

The repeatable bounded reproduction is:

```sh
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' \
  vp exec node scripts/patients-performance/report-release.cjs
```

It uses a full finite raw fixture, reserves its 256 KiB output inside the original 32 MiB storage allowance, and records
actual six-route live/snapshot, rejected activation and legacy rollback results, source metadata, genuine driver/Reader /
shared/renewal/HTTP/capacity receipts, exact runtime/product/tool bytes and final ownership. It is not a scale benchmark,
100-load page run or target acceptance. Historical #33/#34 artifacts retain their original revisions and measurements.

Local versions remain Node 24.22.0, MongoDB 7.0.9, driver 6.10.0, roaring 2.7.0 and Vite+ 1.1.0 on Darwin arm64. Linux
amd64/native and actual target compatibility remain unverified. Whole-project formatting and legacy ESLint baseline
failures are reported separately from changed-file checks.

Final focused validation passed **8/8 public tests in 64.44 seconds** on the formatted source. The bounded report records
**24 parsed full responses**: six live and six snapshot 200s with the exact source/state/no-store metadata, six exact 503s
after rejected review, and six legacy rollback 200s with unknown provenance. Actual monitored commands were 323 live,
200 snapshot and zero for rejected activation; every timed load retained genuine safe per-route dependency proofs. Final
control held one occupied slot, zero pins and zero capacity owners. The ten-record finite raw source and its source hash,
history, policy, runtime and 145 execution-file hashes are recorded in `ticket-35-fixture.json`.

The original raw report is 83,953 bytes, SHA-256
`ead84821ae853af74a6195256c807bdececf4ebf105d774046766fca978d7b07`. The formatted committed JSON has the same decoded values;
formatting does not change any recorded source/response/file digest. All nine target gates remain unverified and target
activation blocked. This report does not establish page or target acceptance.

Changed-path checks passed for all 22 files, including 20 JavaScript files, with no warnings/errors. Mandatory full-project
`vp check` still reports the 35 pre-existing formatting failures, and `vp run lint` still fails because ESLint 9.18 has no
flat configuration. No unrelated formatting or dependency change was made. The complete serial-suite result and exact
tested-tree provenance are recorded in the completion handoff after that run.

The single full serial run passed **128/128 tests across 16 files in 1,040.49 seconds**, with no unhandled errors. It used
the original `vp test` suite and inherited serial fixture scheduling, with a task-local 1,800-second idle-sleep guard. No
application/test deadline, source history, category, assertion or resource ceiling changed to obtain the pass. Runtime,
test, tool and configuration files match the captured pre-run byte inventory; only this Markdown completion/operational
clarification changed after the full run. This is worktree validation; no postmerge full run is claimed.
