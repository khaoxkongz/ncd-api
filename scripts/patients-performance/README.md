# Six-endpoint legacy contract

This extends the historical controller/database harness from commit
`81cefd954478cea912a5635f928b3ca839e01271`. It uses the existing six HTTP
controllers and a real isolated MongoDB database. No test route is added to the
application.

Use Node 24.22.0 and a dedicated local MongoDB 7.0.9 server. The MongoDB driver is
pinned by the project lockfile to 6.10.0. Supply an explicit credential-free
loopback connection; the harness never loads `.env`. Each test creates and drops
only its own `patients_contract_<UUID>` database.

```sh
vp install
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' vp test
```

The port is the fixture server's actual port. Remote hosts, credentials, and a
caller-selected database are rejected. The tests do not start or install a
MongoDB service.

`contract-fixture.cjs` retains the historical 97 cases and adds 24 cases for typed
identities/geography, conflicting predicates, historical geography, stored/date
period disagreement, invalid date inputs, missing/null membership arrays,
formatting errors, expense ties, and snapshot variants. It uses deterministic
synthetic summary data; it is not a full raw source export or capacity workload.

`references/legacy-six-endpoints.json` contains 121 cases × six endpoint responses.
The accepted source revision is `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`.
The test extracts that source with `git archive` into a temporary directory and
reproduces the references. It then compares the current source against the same
references. Source data, request types, calculation clocks, timezones, snapshot
identity, and source revisions are fixed. Status, JSON fields/types/values/order,
content type, routing, and safe query-error evidence are exact; only object-key
order is ignored. All existing legacy expense arithmetic and errors are retained.

To intentionally capture the accepted baseline again, use the explicit command
below. It captures twice and refuses to write unstable references. A normal test
run never updates references.

```sh
PATIENTS_TEST_MONGO_URI='mongodb://127.0.0.1:27187/?directConnection=true' \
  vp exec node scripts/patients-performance/contract.cjs record-baseline
vp fmt scripts/patients-performance/references/legacy-six-endpoints.json
```

`NCD_PATIENTS_BACKEND` is the single selection setting for all six endpoints.
Unset or `legacy` selects the existing services. `read-model` returns the agreed
503 before reads because no validated full candidate or release evidence exists
in this ticket. Other values fail explicitly with the existing 500 envelope.
Legacy startup does not import a native codec or initialize a source adapter.
The startup test uses the existing Express app with synthetic environment values,
an unavailable native codec, and no source configuration.
