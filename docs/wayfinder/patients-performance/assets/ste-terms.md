# Project technical terms

## Document field

This term list is for the Patients performance map and its tickets.
The subject fields are software, database measurements, and patient-count calculations.
The terms keep one name for each concept.

The technical nouns use ASD-STE100 rule 1.5 categories for computing, mathematics, documentation, roles, and medical terms.
The technical verbs use computer-process actions under ASD-STE100 rule 1.12.

## Technical nouns

| Term                 | Meaning in this document set                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Map                  | The index of decisions and tickets for this work.                                                   |
| Ticket               | A tracker document with one question, dependencies, and a completion condition.                     |
| Frontier             | Tickets with `Status: open`, `Assignee: unassigned`, and only dependencies with `Status: resolved`. |
| Session owner        | The person who directs work on a claimed ticket.                                                    |
| Decision ticket      | A ticket that ends with a choice from the user.                                                     |
| Execution task       | Work that creates data or tools, measures the system, or changes the system.                        |
| Baseline code        | The Patients code before a performance change.                                                      |
| Reference response   | The response from baseline code for the selected data snapshot, clock, and request.                 |
| Baseline measurement | A measurement before a performance change.                                                          |
| Response comparison  | A test that compares a new response with its reference response.                                    |
| Query plan           | The database stages and indexes for a query.                                                        |
| Read model           | Data that a read query uses instead of recalculation from source records.                           |
| Precomputation       | Calculation before a read request.                                                                  |
| Synthetic workload   | Test data from a generator and the requests that use that data.                                     |
| Profile              | The parameters for test volume, CID reuse, dates, and geographic fields.                            |
| Random seed          | The value that lets the generator make the same data again.                                         |
| Membership           | One CID occurrence in a CID array.                                                                  |
| Distinct count       | A count after removal of duplicate identities in the selected scope.                                |
| Decimal rounding     | A calculation that limits decimal places.                                                           |
| Test harness         | Code that calls baseline logic and records results for a test.                                      |
| Bottleneck           | The operation or resource that limits response performance.                                         |
| Request              | An application or HTTP call to an endpoint.                                                         |
| CID                  | The patient identity value that baseline code uses.                                                 |
| Snapshot             | Data or calculated results from one selected time.                                                  |
| Map scope            | The questions and limits that this map includes.                                                    |

## Technical verbs

Use these verbs for computer operations only:

| Verb      | Computer action                                                |
| --------- | -------------------------------------------------------------- |
| Call      | Invoke a function or endpoint.                                 |
| Parse     | Change input text into a program value.                        |
| Return    | Send a result from a function or endpoint.                     |
| Throw     | Cause a program exception.                                     |
| Hash      | Calculate a hash from an input value.                          |
| Load      | Put data into a program or database.                           |
| Refresh   | Replace calculated data with results from another calculation. |
| Configure | Set parameters in a program or service.                        |
| Create    | Make a file, ticket, data object, or test tool.                |
| Round     | Calculate a value with the selected number of decimal places.  |

## Identifiers and names

Tracker fields and values are fixed text.
This includes `ID`, `Type`, `Labels`, `Mode`, `Status`, `Assignee`, `Blocked by`, and `Parent`.
The values `grilling`, `task`, `HITL`, `AFK`, `open`, `claimed`, and `resolved` keep their tracker meanings.

Source identifiers, paths, API fields, operator names, and product names keep their spelling.
The English names Total and Other describe graph series in this documentation.
The API response keeps its label strings from baseline code.

Card, Bar chart, Disease graph, DM graph, and CA graph name the five Patients parts.
DM, HT, COPD, CA, HG, CKD, ACS, and CVA keep their source-code meanings.
UAT means the environment for user acceptance tests.
ENV means environment variables.

## Migration note

The tracker fields above describe the original Local Markdown documents.
GitHub now stores status, assignees, and dependencies in native issue fields.
The frontier contains open, unassigned sub-issues whose blocking issues are all closed.
