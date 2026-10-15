# Ticket 19: immutable cut to exact Patients Bar

Implemented on `codex/patients-ticket-19`, based on integration commit `2eb4489127b334c5696a1a113c89600f80b57eec`. Product reference: `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`. Evidence date: 2026-10-15. This is isolated local backend evidence. Production remains on legacy. The user deferred frontend work.

## Result and boundary

The Builder consumes a producer-sealed BSON export, rebuilds baseline hospital-day summaries, finalizes identities once, creates a Mongo-equivalence patient dictionary and portable daily sets, and validates the six Patients Bar counts/services against independent baseline aggregations. The Reader selects historical typed daily metadata, unions all eligible contributions within each ordinal block, then adds disjoint block cardinalities. The existing Patients Bar controller can exercise this candidate under an explicit private process-side validation context.

`NCD_PATIENTS_BACKEND=read-model` still returns 503 for all six public routes. A candidate remains `complete: false`, its unfinished components are named, and `publish()` rejects it. The private validation context has no HTTP flag, header or additional route. Other endpoint adapters, monthly families, Card union/hospital facts, exact expense policy, snapshots, publication/pins/cleanup and release evidence remain incomplete.

The captured existing-widget payload is in [ticket-19-fixture.json](ticket-19-fixture.json), including the actual status, parsed body and request from the exported Express app. The result is the existing six Thai disease rows in the existing order, with counts `[2,1,1,1,1,1]` and averages `[2,1,1,1,1,1]`. This is API evidence; no dashboard rendering or page timing is claimed.

## Interfaces for subsequent tickets

Only the Builder and Reader are public model interfaces:

```js
const builder = createBuilder({ db });
const candidate = await builder.build(sourceCut, declaredBudget, comparisonContext);
await builder.publish(candidate, expectedActive); // Rejects incomplete output.

const reader = createReader({ db, generationId, validationOnly: true });
await reader.read(requestContext, async ({ rangeFacts, monthFacts, snapshot }) => {
  const facts = await rangeFacts(typedSelection);
  // Consume any expense operands before this callback completes.
  for await (const sixOperands of facts.expenseOperands) {
    // Each operand is { present: true, value: originalBsonValue } or
    // { present: false }. No normalization or Mongo sum has narrowed it.
  }
  return facts;
});
```

`rangeFacts` returns six counts, six baseline service sums, `matchedRows`, empty-state information and source provenance. It exposes no patient/dictionary IDs. `monthFacts` and `snapshot` currently reject. `requestContext` carries the route identity, calculation clock, server timezone, backend mode, optional cancellation signal and timeout at most 60 seconds. Equivalent typed BSON selections/version/route contexts share in-flight range work. Entries disappear after success or rejection; a caller's cancellation does not prematurely abandon another caller's database work.

Private schema constants name all 15 category bindings. `patients_daily` retains the original typed geography, date, stored year/month, original service/expense fields and missing/null/array membership state. Its `members` entries point to per-category chunk inventories. Chunks and their separate directory use generation, set, category, Int64 block and chunk identity. This supports later month/Card/expense work without retaining original patient arrays in serving metadata. In particular, a later Card implementation must honor missing/null operands rather than blindly OR six Bar sets, and compute its separate `$add` from the retained original service fields. The hospital dictionary is explicitly unfinished.

The Builder's private stage sequence is the extension point for subsequent components. Add their generation inventories and independent comparisons before completing their component flags. Keep the generation partial until all required components and operational checks exist. The final build currently removes only its temporary raw/summary/member/edge staging; published generation retention and safe reclamation belong to the control implementation.

## Source, equality and storage decisions

- `sealed-bson-v1` requires the BSON manifest bytes, detached signature, local export filename and a separately configured trusted producer public key. The signature is verified before records are consumed. The signed statement must name a sealed full export, actual version/cut time, complete finite domain, history bounds, record/byte counts, digest and collation. Independent comparison context supplies expected domain revision/history. A collection plus `readOnly`, matching hashes or matching counts is rejected. Transport integrity is verified before staging and again during streamed ingestion.
- The fixture producer owns all ten synthetic records in its declared two-day finite domain. It writes all records, closes/seals the export and signs the statement with an ephemeral Ed25519 key. This proves this fixture's producer statement and transport. Production producer trust, complete supported history, original ordering and consistency evidence require a real operator handoff; this fixture cannot establish those properties for another source.
- Raw input follows the existing migration pipeline unchanged except for injecting its terminal collection name. Pipeline construction no longer imports deployment Mongo initialization. The existing hash finalization and Builder share one pure `finalizeCid` implementation; raw summaries are finalized exactly once. Direct signed summary fixtures are a separate explicit comparison mode and never count as full raw proof.
- Patient equivalence comes from Mongo `$group` under the source collation. Original values remain normal fields; dictionary ordinals are BSON Int64 in `[0,2^63)`. Lookup uses exact literal expression comparison; ordinary indexed equality is used only after it agrees. A scalar `7` can match the multikey index entry for `[7]`, so ambiguous indexed matches use the exact class. No hash/string conversion defines dictionary identity.
- Identity cursors preserve numeric BSON kinds, Long, Binary and BSON regular expressions. Service aggregation deliberately retains the baseline driver/operator behavior. Disease scalar aggregation uses accumulator `$sum`, preserving its ignored nonnumeric operands. Presentation retains the original `reduce`/division/`toFixed(2)`/`Number` sequence and patient denominators.
- Ordinal block arithmetic uses BigInt and Int64, with `2^26` offsets per block. Portable payloads contain whole containers, using at most 119 consecutive container positions per chunk under the default 960 KiB target. Every payload and complete BSON document is checked against the declared limits (at most 960 KiB and 1 MiB). The native two-container no-run golden vector verifies portable interchange on the actual runtime. This small fixture does not measure dense maximum-size chunk performance or full-volume block fan-out.
- The Reader reads selected daily metadata in one aggregation, then streams selected chunks in ordinal-block order. Each chunk must match its independent directory header/checksum, native decoded count/bounds and expected daily chunk/member totals. Generation row/chunk/directory counts also agree with the manifest. There are no per-row/category application round trips or unbounded identity maps. The extra directory is included in storage/index inventories.

## Tests and red/green evidence

Tests use the agreed Builder/Reader seams, the actual exported Express application/controllers and real MongoDB 7.0.9 UUID fixture databases. Baseline comparisons use an archive of the exact accepted source revision. All identifiers are synthetic. No Production/UAT source writes or exports occurred.

The eight new tests cover full raw ETL/finalization, exact Patients Bar payloads, 33 paired HTTP selections, typed/falsy/operator-valued/conflicting filters, inclusive intraday boundaries, invalid/omitted/typed dates, overlap and duplicates, BSON numeric equivalence, null/array/document/Binary/ObjectId/date/regex identities, collation, scalar-only and sparse operands, native portable interchange, empty cuts, invalid source proof, baseline ETL/array errors, declared budget overruns, missing rows/chunks, changed payload/version, concurrent equivalent reads, cancellation/deadline failure and recovery, inactive serving and missing snapshots.

Observed red stages, each followed by its implementation and green rerun:

1. Builder/Reader imports absent; added the raw-to-daily range path.
2. Candidate HTTP request returned 503; connected the existing controller to the private candidate adapter.
3. Numeric identity versus array multikey lookup was ambiguous; retained exact Mongo expression fallback.
4. A signed wrong-domain export was accepted; bound the producer domain to independent expected coverage.
5. Collation index inventory was missing; added collation-compatible lookup/selection indexes and reporting.
6. Deleting a daily row returned a successful partial result; enforced generation and streamed directory/member inventories.
7. The Builder had no independent differential result; added its full-supported-history validation stage.
8. A JSON date with its own null `toString` returned 500 instead of the exact baseline input-error envelope; preserved pre-read snapshot/date coercion behavior. These input validation outcomes do not convert a failed model read into zeros.

Commands run:

```sh
vp install
vp exec npm install-scripts approve roaring
vp exec npm rebuild roaring
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-read-model.cjs
vp check
vp run lint
git diff --check
```

`vp test`: all 14 tests in four files pass, including the retained six-endpoint baseline/reference and codec-independent legacy startup tests. The existing reference has 121 six-endpoint cases. Changed-path `vp check` passes with zero errors and the two existing Mongo `$cond.then` warnings. Full `vp check` fails on 35 pre-existing formatting files. `vp run lint` fails because ESLint 9.18.0 cannot find a flat config; the repository retains its old ESLint configuration. `vp install` succeeds; the native optional dependency is exactly `roaring@2.7.0`, with its exact install-script allow entry. The pre-existing npm audit reports 21 vulnerabilities; no unrelated dependency remediation was attempted.

## Measured fixture limits and remaining gates

[The repeatable sanitized report](ticket-19-fixture.json) records Node 24.22.0, Mongo driver 6.10.0, MongoDB 7.0.9 and roaring 2.7.0 on Darwin arm64. The actual build timezone was Asia/Bangkok; HTTP comparisons use a separate fixed UTC calculation clock.

The captured raw build has 2,434 source bytes, ten raw records, four hospital-day rows, six patient classes and nine chunks plus nine directory entries. It completed in about 629 ms. Observed Builder peak RSS was 105,660,416 bytes, additional RSS 20,824,064 bytes, native bitmap allocation 1,344 bytes and peak additional stored BSON/index/file allocation 272,770 bytes. The serialized allocation reservation peak was 93,420 bytes; this is a conservative tracked reservation for owned buffers/copies, not a complete driver/database memory measurement. The single captured HTTP response completed after JSON parsing in about 65 ms. These are one small local run, not p95, page or Production evidence.

Declared fixture limits were fixed before execution: 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one serial heavy stage. Oversized records/results or exceeded limits fail the whole candidate rather than skip data. Source copies, staging, dictionaries, directories, indexes and retained model collections are charged in sampled storage peaks. RSS and native allocations are sampled throughout controlled loops; these samples are not continuous OS/DB peak instrumentation.

Production headroom, database aggregation/index/cache memory, CPU/IO quotas, dense/large-block growth, full raw/source volume, supported historical coverage, concurrent serving/build peaks, end-to-end deadlines under lost networks/workers, fencing/pins/two-slot cleanup, refresh/freshness SLAs and actual dashboard performance remain unverified release gates. Mongo operations use remaining `maxTimeMS` and cursors settle/close on completion/failure. Driver 6.10 cancellation is not proof of remote termination; no such claim is made. The $0 spending limit is unchanged; no job, deployment or external notification was installed or sent.
