# Ticket 18 validation

Implemented on `codex/patients-ticket-18`, based on integration revision
`2deb5b2e05c77f685075d59c5d8fa61a3ebc42fe`. Product references come from the
accepted revision `0a1934df24b1b66a2edbe2cb3e8235a7073932a7`; historical harness
prior art is `81cefd954478cea912a5635f928b3ca839e01271`.

One shared backend selector now precedes reads in all six existing controllers.
Legacy is the default. The unfinished candidate cannot activate. Existing legacy
response handling, repositories, services, expense arithmetic, and routing remain
unchanged, as checked through HTTP.

## Red and green

- `vp install` succeeded. Its incidental lockfile root-name change was reverted;
  dependencies did not change.
- First tracer: `vp test scripts/patients-performance/server.test.js` with the
  isolated fixture URI failed because expense Bar was absent from the historical
  five-route harness (404 HTML). Adding the sixth existing controller made it
  pass.
- Second tracer: the same command failed when `read-model` still returned six
  legacy 200 responses and read source collections. The shared selector and
  targeted failure handling made every route return exact 503 with no source read.
- Baseline reference capture ran twice and compared exactly: 121 cases, six
  endpoints, 726 external responses per pass. These include the historical 97
  cases plus 24 additional cases. The Card matched-row/empty-patient reference
  remains HTTP 500. Legacy scalar-only expense remains numeric 1 with average 0.
- The current source matched all 726 references exactly. Tests also cover unknown
  backend configuration, empty real MongoDB fixtures, and existing Express app
  startup/serving when the native codec is unavailable and source settings are
  absent. No public test-only route or frontend token was introduced.

## Environment and checks

Actual environment: Node 24.22.0, Darwin arm64, MongoDB server 7.0.9, MongoDB
Node driver 6.10.0, Vite+ 1.1.0, Vitest 5.0.3, Oxlint 1.87.0, Oxfmt 0.72.0.
The machine's server timezone was not assumed: every comparison case fixes its
clock/timezone, including UTC and Asia/Bangkok boundary cases. The source fixture
BSON digest is `b64cb2bae014489c4c4942ddf6691d676e2085c2d6e915d483c25f98be8c94c4`.
Snapshot identity and runtime/source/tool versions are recorded in the reference.

`vp check` initially failed on 42 existing source formatting differences. The six
touched controllers were formatted with Oxfmt. The redundant Prettier lint rule
used conflicting defaults and rejected Oxfmt output, so it is disabled in
`vite.config.ts`; Oxfmt remains enforced by `vp check`. No unrelated source files
were reformatted.

Final results:

- Changed-path `vp check`: passed, 20 formatted files and 17 lint/type-checked
  files, with no warnings.
- `PATIENTS_TEST_MONGO_URI=<explicit loopback fixture URI> vp test`: passed,
  3 files and 6 tests in 10.68 seconds. Every fixture database was removed.
- Full `vp check`: failed on 36 pre-existing formatting differences in untouched
  source files (down from the initial 42 because six controllers were touched).
- `vp run lint`: failed as at baseline; ESLint 9.18.0 requires an
  `eslint.config.js` but the repository supplies only its legacy configuration.
- `git diff --check`: passed. Merging the integration branch tip reported
  already up to date.

## Limits

Spending was $0. All writes were limited to UUID databases on the explicit local
fixture server; they were removed after each run. No Production or UAT data was
read or changed. Reports contain aggregate synthetic outputs and safe errors,
with no credentials or patient identities. The inherited generator's raw
pipelines stay in memory and are not published.

These are backend correctness and startup checks on small synthetic summary
fixtures. Raw-source consistency/coverage, a full candidate, native codec
interoperability, representative capacity/timing, actual dashboard rendering and
freshness display (frontend implementation is deferred by the user), and every other accepted release gate remain unverified.
There is no deployment, scheduler installation, export, or optimized activation.
