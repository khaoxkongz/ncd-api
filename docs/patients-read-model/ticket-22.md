# Ticket 22: one stored-month matrix for all Patients graphs

Implemented on `codex/patients-ticket-22`, initially based on integration commit `0a53bb6f8e4dcea300ee7113aec22007d09e9ef6`. Integration commit `14adb5e7d79b24c3e12f6dfcd5ecb9f13d5e5d83`, including ticket 20, was merged in `f76f883`. Accepted product reference: `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`. Evidence date: 2026-10-15. These are isolated local backend results; frontend work is deferred.

## Result and retained gates

The Builder now creates exact stored-period bitmap atoms for all fifteen categories, retaining the original typed year/month and historical `(hcode,area,province,district)` tuple. These periods stay separate from summary dates and the unfinished UTC date-month family. The Reader returns one ordered twelve-by-fifteen matrix. The three existing graph controllers consume that matrix through private candidate validation, sharing DM and CA base entries.

Disease Total still adds the six disease counts. All labels, series order, twelve numeric positions, successful absence zeros and clamped DM/CA Other subtraction match the accepted baseline. Request dates and request year do not affect graphs. The adapter captures one calculation clock and the actual server timezone and constructs the server-local current month plus preceding eleven months.

The candidate remains `complete: false`. Stored months, Patients Bar and expense Bar are complete components; date-month atoms, prepared scopes, Card, hospital dictionary, snapshots and control/publication remain incomplete. `publish()` rejects the candidate. `NCD_PATIENTS_BACKEND=read-model` remains unavailable for all six serving routes. The existing private validation context adds no HTTP flag, test route or frontend token. A selected snapshot remains a separate route identity and fails with 503 while snapshots are incomplete; there is no live fallback.

Ticket 20's canonical daily expenses, integrity checks, exact range totals and expense Bar adapter remain intact. Versions are `patients-daily-and-stored-months-v1`, `mongo-equivalence-v1`, `roaring-2.7.0-portable`, `expense-v1` and `baseline-services-v1` for service arithmetic.

## Storage and Reader behavior

`patients_month_atoms` uses unique `(generationId,periodKind,periodKey,partitionId)` plus a generation/set lookup index. Period and partition keys are complete BSON byte encodings, with original typed fields retained on metadata. This can split Mongo-equivalent geographic tuples into extra partitions; selection applies the original Mongo predicates to those fields and unions their sets, so the split does not change patient equality. Patient classes still come exclusively from the Mongo-equivalence dictionary. No raw patient values are retained in atom metadata or exposed by Reader results.

The stage streams source summaries, per-row atom mappings and dictionary edges. It unions repeated daily contributions into monthly portable chunks using the existing bounded writer and independent directories. It does not materialize all partitions or identities in application memory. Staging, atom data, chunks, directories and indexes are included in sampled storage accounting before temporary month mappings/edges are removed.

Period indexes and each independent geography/period index use the producer collation and a partial filter for periods whose driver-promoted values can pass the graph presenter's strict numeric comparison. All original typed metadata remains stored. This avoids unsupported parallel-array index keys without converting periods. The Builder report and captured fixture include the actual index definitions and partial filters.

The accepted Reader interface is:

```js
await reader.read(requestContext, async ({ monthFacts }) => {
  const facts = await monthFacts(typedGeographicScope, twelveOrderedNumericPeriods);
  // facts.counts[month][category], facts.periods, facts.categories, facts.source
  return facts;
});
```

The Reader validates the generation/atom/chunk/directory inventories, selects all effective combined geographic predicates on atom metadata, and reads all fifteen categories in one chunk stream. Chunks are ordered by ordinal block, month and category. It unions all eligible contributions for that cell/block, adds the resulting disjoint block cardinality, clears the native bitmap and continues. Only one union bitmap and one decoded contribution are held at a time; the count and inventory matrices have fixed size. Header/directory, payload checksum/version, decoded interval/cardinality and selected chunk/member totals must agree. Missing or corrupted data fails the request rather than producing successful zeros.

All three live graph adapters use the same fact-route identity. Sharing also requires equal complete BSON scope keys, period window, timezone, timeout, generation and versions. The entries are removed after success or failure. Snapshot routes retain their selected endpoint identity. A caller's cancellation does not abandon another caller's database work; freshness is attached using each caller's captured clock after shared work settles. There is no retained result cache or raw per-category patient grouping during optimized requests. Independent per-category baseline grouping is confined to Builder validation and reference comparisons.

## BSON and membership compatibility evidence

The baseline graph presenters use strict JavaScript numeric period comparisons after Mongo grouping. Real baseline HTTP comparisons show that Int32, safely promoted Long and Double periods are presented, while a Decimal128 year or month can satisfy Mongo's numeric predicate and still produce zero in the graph. Missing, null, strings and a single array-valued period also retain their observed baseline behavior. The implementation preserves the original values and the same driver promotion before deciding presentation eligibility.

A repeated baseline probe with Int32 and Decimal128 years in the same numeric month/category returned final Disease DM counts `[2,2,2,0,2]` across five identical HTTP requests. This is unstable reference evidence, not a count to normalize. The Builder rejects a mixture of presentable and nonpresentable numeric kinds within a participating category and possible numeric graph period. Mixed kinds in separate categories, empty rows or periods that cannot occur in a numeric twelve-month window remain valid. The test suite verifies the rejection and the stable cases separately. Acceptance of that unstable source case would require a later decision; optimized activation is already blocked.

Graph repositories directly unwind membership fields. The nine graph-only subtype operands now use that same relation, including scalar strings, false, zero, documents, dates, Binary, Long/Decimal128 numeric identity equivalence, null members and duplicate contributions. The six base operands retain Bar `$setUnion` validation. Existing invalid base-array candidate rejection remains covered. This preserves the graph-specific scalar behavior without weakening the Patients Bar contract.

## Tests and red/green evidence

Tests use the agreed existing Express application/controllers and actual Builder/Reader interfaces on real MongoDB UUID fixtures. The baseline source is archived at the accepted commit. Fixed clock/timezone reference requests are repeated before comparison. HTTP assertions compare status, content type, parsed values/types/presence and ordered series/points. The immutable 121-case six-endpoint legacy artifact remains unchanged.

Seven monthly tests cover stored-date disagreement; typed/missing periods; independent, contradictory, typed, missing, array and operator-valued geography; historical moves; overlaps/duplicates and all Other outcomes; absent/sparse months; local month/year boundaries; request date/year independence; strict snapshot routing; scalar subtype behavior; stable and unstable BSON mixtures; corruption/inventory/version failures; concurrent reads, cancellation, deadline failure and recovery after settlement. Approved read-model failures return the existing 503 envelope with no result. The retained tests also exercise raw ETL/finalization, empty cuts, native interchange, expense arithmetic, source failures and inactive serving.

Observed failing assertions/errors followed by implementation and passing reruns:

1. `monthFacts` rejected as incomplete; added stored atoms, the ordered Reader and existing graph adapters.
2. Builder monthly differential evidence was absent; added independent direct-unwind reference checks across supported stored periods, including periods outside the cut clock window.
3. The typed-period fixture could not build a parallel-array period index; restricted serving indexes to presentable numeric periods while retaining original metadata.
4. Monthly facts omitted source provenance; added caller-clock freshness after shared work settles.
5. Stable mixed periods in separate categories were rejected; made the instability guard category/membership-specific and ignored impossible numeric graph periods.
6. Scalar subtype operands failed Bar `$setUnion`; staged those graph-only operands with direct unwind and retained base Bar validation.

Commands run:

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-monthly-read-model.cjs
vp check <changed paths>
vp check
vp run lint
git diff --check
```

The final combined suite passes all 28 tests in six files. Changed-path formatting, lint and type checks pass with no warnings or errors. Full `vp check` fails on the same 35 untouched formatting files. `vp run lint` retains the existing ESLint 9.18.0 flat-config failure. `vp install` succeeded; its unrelated lockfile name-only churn was reverted. No dependency versions or install-script permissions changed in this ticket.

## Captured fixture and limits

[The repeatable sanitized report](ticket-22-fixture.json) contains all three existing graph payloads from a producer-sealed full raw fixture, the shared matrix, source digest/coverage, generation/components, versions, indexes, stages, measured Builder resources and parsed-body timers. The reference is rebuilt independently with the accepted raw ETL and once-only identity finalization. All three payloads match a repeated baseline reference. In the occupied month, base counts are `[2,1,1,1,1,1]`, Disease Total is `7`, DM Other is `2`, and CA lung is `1` with CA Other `0`.

The fixture has ten raw records, 2,434 source bytes, four hospital-day rows, six patient classes, two stored-period/historical-geography atoms and seventeen chunks plus seventeen directory entries. The captured build took approximately 890 ms. Observed Builder peak RSS was 106,545,152 bytes, additional RSS 21,282,816 bytes, native bitmap allocation 1,344 bytes, tracked serialized-buffer reservation 103,092 bytes and peak additional stored BSON/index/file allocation 448,898 bytes. These are sampled/tracked local observations, not complete continuous process/database measurements.

The captured parallel three-graph response completed after JSON parsing in approximately 54 ms. This is one small local API run, not p95 or page-performance acceptance. The actual runtime is Node 24.22.0, driver 6.10.0, MongoDB 7.0.9 and roaring 2.7.0 on Darwin arm64. The Builder timezone was Asia/Bangkok; captured HTTP graph calculations used fixed UTC, and tests separately exercise UTC and Asia/Bangkok boundaries.

Budgets were fixed before each run: 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one serial heavy stage. There was no budget enlargement after failure. Database aggregation/index/cache memory, dense/large-block behavior, supported Production history/cardinality, concurrent serving/build peaks, verified host headroom, remote cancellation, publication/pins/cleanup, refresh/freshness SLAs and actual dashboard rendering/page timing remain unverified release gates. No Production/UAT write or export, scheduler, deployment, resource purchase or external message occurred. Spending remains $0.
