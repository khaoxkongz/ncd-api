# Ticket #20: exact expense Bar

Implements [#20](https://github.com/khaoxkongz/ncd-api/issues/20) against the accepted [#17 specification](https://github.com/khaoxkongz/ncd-api/issues/17), on top of integration commit `0a53bb6f8e4dcea300ee7113aec22007d09e9ef6`. The existing expense Bar controller can read a private validation candidate. Its six labels, order, numeric fields, success envelope, patient denominators, scalar-only contributions and concrete date/geography predicates remain compatible. The legacy arithmetic path is unchanged.

The candidate remains `candidate-partial`, `complete:false`, and unavailable for publication or serving. `NCD_PATIENTS_BACKEND=read-model` still returns the approved unavailable error. No HTTP input can select a partial candidate. The process-side validation context uses the actual existing application and controller. Missing snapshots remain unavailable until compatible views are implemented.

## Exact policy and reusable facts

`src/modules/patients/read-model/expense.js` implements `expense-v1`. The generation names this arithmetic policy separately from `serviceArithmetic:baseline-services-v1`. The Builder retains original independent BSON daily expense fields. A one-row Mongo accumulator `$group/$sum` applies the baseline ignore behavior before conversion: missing, null, strings, arrays, documents, booleans, Binary and date operands produce the original zero contribution. Arrays are not traversed as projection `$sum` would traverse them. Raw source conversion and baseline ETL/finalization are unchanged.

Finite Double/Number operands use the pinned runtime's decimal `Number.toString()` text. Int32 and Int64 use integer text without Number narrowing. Finite Decimal128 uses its exact decimal text. Parsing, scale alignment and addition use BigInt; stored values are canonical signed coefficient strings and nonnegative integer scales. Zero and trailing fractional zeros are normalized. Non-finite or unsupported resulting operands fail validation. This does not recover precision already lost in baseline ETL.

Each daily row stores six canonical operands, the expense version and an expense checksum. The Reader checks these fields and the existing generation/row/chunk inventories, streams selected daily operands, and returns six exact unrounded `expenseTotals` in `rangeFacts`. Original BSON `expenseOperands` remain available. Missing, incompatible or changed exact facts fail the selected response. These canonical daily operands and reusable addition/rounding policy are available for later Card and monthly sums; this ticket does not implement those presenters or their remaining components.

Final amount rounding and final exact unrounded-total/patient rounding use integer quotient/remainder with ties away from zero. A zero patient denominator returns numeric zero for the average while preserving the scalar amount. No daily, monthly or subtotal result is rounded. Final decimal text is converted to a finite Number, serialized and parsed, then checked against the exact normalized integer cents. A changed cent value fails candidate validation or becomes HTTP 503 `{status:false,message:"Read model unavailable"}` for a selected response, without a `result` field. All other input-coercion and legacy error references stay separate.

Stored scale validation covers finite Decimal128 scale through 6176. The coefficient bound includes its 6145 possible integer digits, 6176 fractional positions, and 16 additional integer digits for sums of at most `Number.MAX_SAFE_INTEGER` rows. This bounds corrupted scale/coefficient allocations without finite-precision subtotals. Exceeded bounds fail; values are never truncated.

## Fixed references and conversion evidence

`scripts/patients-performance/expense.test.js` contains explicit normalized expense-v1 references at the accepted public HTTP and real Builder/Reader seams. Its expected numbers and coefficient/scale literals are independent worked/spec examples. It does not test helper implementations or use tolerance. `references/legacy-six-endpoints.json` remains unchanged; baseline comparisons archive revision `0a1934df24b1b66a2edbe2cb3e8235a7073932a7` and run its real controllers.

| Fixture                                                                    | Exact expectation                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Double `1.005`, one patient                                                | amount/average `1.01`                                                                         |
| Decimal128 `2.675`, two patients                                           | amount `2.68`, average `1.34`                                                                 |
| Decimal128 `-1.005`, one patient                                           | amount/average `-1.01`                                                                        |
| Decimal128 `12.345`, zero patients                                         | amount `12.35`, average `0`                                                                   |
| Two diseases with `0.004` each                                             | each Bar amount/average `0`; exact facts retain `{coefficient:"4",scale:3}` for each          |
| Repartition `0.008`, `0.004` and `-0.01` across one, two or four rows/days | exact totals and HTTP numbers unchanged; `0.008/2` average is `0`, while `-0.01/2` is `-0.01` |
| Int64 `9007199254740993` plus `-9007199254740992`                          | exact scalar `1`, without Number narrowing                                                    |
| Int32 `-7` plus `7`                                                        | canonical zero                                                                                |
| Decimal128 `1E+6144`, `1E-6176`, `-1E+6144` plus Double `1.005`            | exact cancellation retains the smallest operand; final amount/average `1.01`                  |
| Raw `"0.1"` and `"0.2"` in one hospital/day                                | baseline Double fact stays `{coefficient:"30000000000000004",scale:17}`, displayed `0.3`      |
| Double and Decimal128 NaN/infinities                                       | candidate validation rejection                                                                |
| Decimal128 `90071992547409.93`                                             | candidate rejection because numeric JSON changes cents                                        |
| Decimal128 `9007199254740991` with three patients                          | candidate rejection because the final ratio changes cents                                     |
| Select only the huge positive operand from the valid cancelled generation  | explicit HTTP 503                                                                             |

The Builder report inventories original expense BSON kinds and the runtime. The conversion fixture includes `double`, `decimal`, `long`, `int` and all ignored kinds listed above. The full raw fixture records eight Double and sixteen Int32 source expense fields across four daily rows. Baseline raw ETL cannot produce original Int64/Decimal128 expense facts, so those conversions use separately declared, producer-sealed summary fixtures while the raw path is independently exercised.

The seven added tests cover both Bar payloads on the same full immutable raw cut, precision already lost in ETL, 34 exact paired baseline date/geography selections, repartitioning, ignored/scalar/empty facts, non-finite and unsafe serialization rejection, changed facts and component compatibility, failure recovery, all golden rounding cases and full BSON exponent conversion. Date cases include arbitrary long, inclusive intraday, invalid, omitted, typed and reversed ranges. Geography includes numeric/string/falsy/whitespace/operator/array inputs and independent conflicting conjunctions.

## Red/green and project checks

Observed red stages, each followed by the minimal change and green rerun:

1. Existing expense HTTP route returned 503 for the new raw-cut reference. Connected the candidate expense adapter and canonical facts.
2. The extreme finite cancellation fixture failed on a daily serialization check. Removed the early conversion and retained exact mixed-scale subtotals through final rounding.
3. A changed valid stored coefficient returned 200 with a wrong amount. Added checked expense checksums; selected corruption now returns 503 and a restored row reads successfully.
4. An incomplete expense component returned 200. Added its generation-bound compatibility check; it now returns 503.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test scripts/patients-performance/expense.test.js
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp exec node scripts/patients-performance/report-expense.cjs > docs/patients-read-model/ticket-20-fixture.json
vp check <changed paths>
vp check
vp run lint
git diff --check
```

All 21 tests in five files pass, including the retained 121-case six-endpoint reference and codec-independent legacy startup. Changed-path formatting, lint and type checks pass. Full `vp check` fails on the same 35 pre-existing formatting files. `vp run lint` still fails because ESLint 9.18.0 cannot find a flat config. No unrelated formatting/configuration remediation was made. `vp install` succeeds and retains `roaring@2.7.0` with its existing exact install-script approval. Its existing audit reports 21 vulnerabilities. The install-only package-name lockfile rewrite was restored to avoid an unrelated change.

The observed runtime is Node 24.22.0, Mongo driver 6.10.0, MongoDB 7.0.9, roaring 2.7.0, Vite+ 1.1.0 and Vitest 5.0.3 on Darwin arm64. The actual build timezone is Asia/Bangkok; the HTTP calculation clock is fixed separately in UTC.

## Measurements and release gates

[The sanitized local report](ticket-20-fixture.json) records a 2,434-byte, ten-record synthetic raw cut and four daily rows. This one build completed in about 589 ms. Observed Builder RSS peaked at 106,692,608 bytes, additional RSS at 22,134,784 bytes, native bitmap allocation at 1,344 bytes, and tracked serialized allocation reservation at 95,556 bytes. Peak charged stored BSON/index/file allocation was 272,770 bytes. Both existing Bar responses are recorded with numeric fields; their parsed-body times were about 64 ms and 11 ms. These are single small local observations, not p95, full-page, concurrent-capacity or Production evidence. The serialized metric is a conservative reservation for owned buffers/copies, not total driver/database memory instrumentation.

Fixed fixture limits remain 30 seconds, 8 MiB source/serialized buffers, 32 MiB storage, 128 MiB additional Builder RSS, 960 KiB payload, 1 MiB full chunk BSON and one serial heavy stage. The Reader retains its 60-second optimized response ceiling. Overruns reject a candidate or selected response; no limit was enlarged to pass a fixture.

Full-source supported-history proof, actual host/quota headroom, database aggregation/index/cache memory, CPU/IO, large/dense data, concurrent API/build/database peaks, publication/fencing/pins/cleanup, snapshots, Card and remaining full components, refresh/freshness SLAs, metadata/error consumer and actual six-result dashboard rendering/performance remain release gates. Frontend implementation is explicitly deferred; API evidence does not close that gate. The $0 spending cap and read-only source permissions remain. All writes and cleanup used loopback UUID fixture databases. No deployment environment source, Production/UAT write/export, scheduler, deployment, paid resource or external message was used.
