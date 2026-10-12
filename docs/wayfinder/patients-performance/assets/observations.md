# Inspection observations

Inspection date: 2026-10-12
Source revision: `6ed1cd3` and the working tree from the inspection.

The previous session inspected the NCD dashboard backend and recorded these observations.
The observations help select questions and test cases.
They are not performance measurements or a diagnosis of the UAT bottleneck.

## Baseline code and results

The active controllers call V2 under `/ncds_api/api/v1`.
The endpoints are `/card`, `/bar-chart-pt`, `/graph-disease-pt`, `/graph-dm-pt`, and `/graph-ca-pt`.
There are also V1 functions, but these controllers do not call them.

The English series names in this document identify the API labels.
Keep the response label strings from the baseline code.

| Part          | Baseline behavior                                                                                                                                                                          | Source                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card          | The `patient_count` calculation counts each array value once in the union of six disease arrays. The count uses the full date range and geographic range.                                  | [countPatient](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/card-summary/card.repository.js)                                                                                                                                                                        |
| Bar chart     | Each disease has a distinct CID count for the full range. The `avg` value divides summed visit counters by that count. The service rounds the result to two decimals and returns a Number. | [CID counts](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/shared/count-cid.repository.js), [V2 service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/bar-chart/patients/chart-pt.service.js)                     |
| Disease graph | Each disease has distinct CIDs for each year and month. The Total series adds all six disease counts without another distinct count.                                                       | [repository](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/graph/disease-patients/disease-pt.repository.js), [service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/graph/disease-patients/disease-pt.service.js) |
| DM graph      | The subtypes are HG, CKD, ACS, and CVA. The Other formula is `max(0, DM - sum(4 subtype counts))`. The formula subtracts counts, not sets.                                                 | [service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/graph/dm-patients/dm-pt.service.js)                                                                                                                                                                          |
| CA graph      | The subtypes are lung, breast, cervical, liver, and colorectal cancer. The Other formula is `max(0, CA - sum(5 subtype counts))`.                                                          | [service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/graph/ca-patients/ca-pt.service.js)                                                                                                                                                                          |

The Bar chart order is DM, HT, COPD, CA, mental health, and cardiovascular disease.
Card adds visit counters from all six diseases.
The read query does not count distinct transaction IDs again.
Card counts distinct hospitals from `hcode`.

Card rounds each disease expense to two decimals before addition.
Card then rounds the total again.
The averages divide by `patient_count` and return a Number.
For formulas, refer to [Card V2](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/card-summary/card.service.js).

### Dates, filters, and cache

The date rules are:

- Card and Bar chart parse input dates and use inclusive `$gte/$lte` bounds. They do not extend the end date to the end of the day.
- Graph controllers send geographic fields to V2. They do not send `startDate`, `endDate`, or `year`.
- Live graph services use the last 12 calendar months. The first month is 11 months before the server month. The last month is the server month.
- Monthly queries use stored `year/month` values. A month without data has zero values.
- The graph response is `{diseaseName,data:[12 values]}`. The response has no month labels.

The filter and cache rules are:

- Live geographic filters use JavaScript truthiness through `...(value && {field:value})`. The code does not trim or coerce values.
- An empty string, `undefined`, `null`, `false`, or numeric `0` omits a live filter. String `"0"` adds a filter.
- Card and Bar chart use a snapshot for start date `2024-01-07` and an end date equal to UTC today. All four geographic fields must also satisfy `== ""`.
- Graphs use a snapshot when all four geographic fields satisfy `=== ""`. Omitted fields cause live queries without geographic filters.
- Snapshot readers return a field from `result[0]`. They do not examine the key or age, or try a live query.
- The snapshot builder calls V2 with Date objects and omitted geographic fields. Those inputs cause live queries.
- The builder uses `2024-01-07` through the snapshot time for Card and Bar chart. Graphs keep their 12-month period from the clock.

For source details, refer to [Card](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/card-summary/card.service.js), [Bar chart](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/bar-chart/patients/chart-pt.service.js), [Graph controller](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/graph/disease-patients/disease-pt.controller.js), and [Snapshot builder](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/migration-temp-table/temp-table.service.js).

### Empty results and errors

The services have these behaviors:

- Card returns one object with zeros when both the scalar result and the patient result are empty.
- If the scalar result has an object but the patient result is empty, `patientCount[0].patient` causes an error. The service throws the error, and the controller returns HTTP 500.
- Bar chart has default zero counts and averages for empty disease results. Its error handlers can also cause zero results.
- A missing snapshot or a cache error can cause the service to return `undefined`. The controller can return HTTP 200 without `result` in the JSON. The code does not try a live query.

A performance tool must keep query errors separate from calculated zero results.
For source details, refer to [Card service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/card-summary/card.service.js), [Card controller](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/card-summary/card.controller.js), [Bar chart service](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/bar-chart/patients/chart-pt.service.js), and [Cache getter](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/bar-chart/patients/chart-pt.repository.js).

## ETL and workload

The ETL pipeline has these rules:

- ETL reads `FDH_Transaction`. Each `NCD_SUMMARY` document relates to one hospital and one day.
- The document has 15 CID arrays, although the field names end with `_cid_count`. Document count and membership count are different measurements.
- Source records must have `hcode`, `area`, `province`, and `district` fields with values other than an empty string.
- Source records must have a `status` field with a value other than `reclaimed`. The date filter uses `claim_date`.
- Each main disease facet has its own diagnosis predicates. A patient can be in more than one facet.
- The six main facets have no common primary-diagnosis condition. Some subtype predicates compare `dx_type` with string `"1"`.
- ETL uses `$addToSet` for CIDs per hospital, day, and disease. A later pass hashes the CIDs with HMAC SHA-256 before snapshots.
- Read repositories use each stored array value without more normalization or hashing.
- Migration starts at `2024-01-01`. Card and Bar chart snapshots start at `2024-01-07`.

The inspection found no watermark or scheduler in the source.

The live paths use these aggregation counts:

| Part          | Aggregations |
| ------------- | -----------: |
| Card          |            2 |
| Bar chart     |            7 |
| Disease graph |            6 |
| DM graph      |            5 |
| CA graph      |            6 |
| Total         |           26 |

The total assumes that all five parts use live queries.
The code inspection does not show the actual order of frontend requests or the cause of the delay.

All declared indexes for `NCD_SUMMARY` start with `date`.
The source has no index declaration for `year/month`.
If the collection is in the database, `createCollection` returns before index creation.
The inspection did not get indexes from UAT.

The inspection found no performance harness, query-plan helper, or application tests.
The application has morgan HTTP logs and migration phase times.
Those logs did not give measurements of the delay in the user report.

For source details, refer to [ETL pipeline](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/migration/pipeline.js), [Migration](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/migration/migration.service.js), [CID hash pass](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/modules/migration/hash-cids.js), [Hash helper](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/lib/utils.js), and [Indexes](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/models/ncd-summary.js).

The [Conditions document](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/docs/conditions.md) differs from executable predicates in some places.
The active code paths are the reference for these predicates.

The previous session compared ASTs for 63 changed source files with HEAD.
The comparison ignored source locations and raw literal formatting.
All executable structures were the same.
This result shows formatting changes in the inspected files.
It does not show that UAT uses the same source revision.

## Environment inspection

The inspection recorded these facts:

- The user still waited for VPN access to Zone UAT. The inspection gave no UAT baseline, plans, indexes, or runtime measurements.
- The user supplied `.env` as the configuration location. Git ignores this file.
- The application reads `MONGO_URI`. The `client.db()` call selects the database from the URI, not from `MONGO_DBNAME`.
- The agent added a `MONGO_URI` alias for `DATABASE_URL`. The agent removed `directConnection=true` from the SRV URL.
- An Atlas ping and collection-name query completed without writes. The database from the URI had no collections during the inspection.
- The agent did not create synthetic data or a test harness.
- The inspection did not get the tier, region, server version, test-database permissions, or storage budget.
- The application schema also makes Discord keys and hash keys necessary. The test harness design must keep business rules and prevent migration during module preparation.

For configuration code, refer to [Environment schema](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/env.js) and [Mongo client](https://github.com/khaoxkongz/ncd-api/blob/ac5750d411f37302018abd7deaf34738a2d5d01d/src/lib/mongo.js).
For database selection, refer to Driver source: `node_modules/mongodb/lib/connection_string.js` (local installed dependency) and [MongoClient API](https://mongodb.github.io/node-mongodb-native/6.10/classes/MongoClient.html#db).

Atlas Free and Flex have limits for data, indexes, and temporary aggregation files.
The cluster hostname does not identify its tier.
For tier limits, refer to [Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) and [Flex limits](https://www.mongodb.com/docs/atlas/reference/flex-limitations/).
For aggregation limits, refer to [Aggregation limits](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/).

## Synthetic BSON sizes

The previous session used `mongodb.BSON.serialize` and `calculateObjectSize` on local synthetic documents.
Both functions gave the same sizes.
Each CID had 64 ASCII hex characters.
Each document had all 15 CID arrays and constant metadata.

These projections are raw BSON sizes, not UAT sizes.
These figures do not include indexes, compression, storage-engine overhead, replicas, or query memory.

The table uses six main arrays with data and nine empty subtype arrays.
The last column gives another case, with equal sizes in all 15 arrays.
That case is a storage assumption, not a disease rule.

| CIDs per array | Six main arrays: bytes per document | 1,000 documents: MiB | 1 million documents: GiB | All 15 arrays: bytes per document |
| -------------- | ----------------------------------: | -------------------: | -----------------------: | --------------------------------: |
| 10             |                               5,374 |                 5.13 |                    5.005 |                            11,854 |
| 50             |                              22,894 |                21.83 |                   21.322 |                            55,654 |
| 100            |                              44,794 |                42.72 |                   41.718 |                           110,404 |
| 500            |                             222,394 |               212.09 |                  207.121 |                           554,404 |

The period from `2024-01-01` to `2026-10-12` includes 1,016 days.
At least 985 hospitals are necessary for 1 million unique `{date,hcode}` documents in that period.
For 365 days, the minimum is 2,740 hospitals.
These limits assume one document per hospital per day.

The profile controls document count, array length, distinct patients, and CID reuse separately.

## Migration note

This document was migrated from Local Markdown to GitHub Issues.
The recorded inspection revision and observations remain unchanged.
Source links open repository snapshot `ac5750d411f37302018abd7deaf34738a2d5d01d` for navigation.
The recorded revision `6ed1cd3` is not available in this clone.
The links do not establish that the inspected working tree matches that snapshot.
