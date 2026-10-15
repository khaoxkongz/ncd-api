const NORMAL_CLOCK = "2026-10-13T05:00:00.000Z";
const NORMAL_TIME_ZONE = "Asia/Bangkok";
const GEO_FIELDS = ["area", "province", "district", "hcode"];
const EMPTY_GEO = Object.fromEntries(GEO_FIELDS.map((field) => [field, ""]));
const FULL_RANGE = { startDate: "2024-01-01", endDate: "2026-10-13" };

const REQUIRED_FAMILIES = [
  "date-ranges",
  "date-boundaries",
  "graph-periods",
  "geographic-scope",
  "filter-presence-and-types",
  "cid-reuse",
  "card-calculations",
  "bar-calculations",
  "disease-total",
  "dm-ca-other",
  "empty-and-sparse-data",
  "stored-snapshots",
  "errors",
  "response-shape-and-order",
];

const FIXTURE_FAMILIES = {
  "arithmetic-overlap": ["cid-reuse", "card-calculations", "bar-calculations"],
  "disease-sum-versus-union": ["cid-reuse", "card-calculations", "disease-total"],
  "dm-ca-other-positive": ["cid-reuse", "dm-ca-other"],
  "dm-ca-other-zero": ["cid-reuse", "dm-ca-other"],
  "dm-ca-other-negative": ["cid-reuse", "dm-ca-other"],
  "empty-patients-positive-scalars": ["empty-and-sparse-data", "errors"],
  "inclusive-partial-day-bounds": ["date-ranges", "date-boundaries"],
  "leap-day": ["date-boundaries", "graph-periods"],
  "range-bounds": ["date-ranges", "date-boundaries"],
  "graph-position-anchors": ["graph-periods", "empty-and-sparse-data"],
  "clock-boundaries": ["graph-periods", "date-boundaries"],
};

// These checks describe the inspected baseline. The runner must record the
// supplying collection from the request trace as well as this expectation.
function expectedSources(body, clock) {
  const utcToday = new Date(clock).toISOString().slice(0, 10);
  const cardAndBarSnapshot =
    body.startDate == "2024-01-07" && body.endDate == utcToday && GEO_FIELDS.every((field) => body[field] == "");
  const graphSnapshot = GEO_FIELDS.every((field) => body[field] === "");
  return {
    card: cardAndBarSnapshot ? "snapshot" : "live",
    bar: cardAndBarSnapshot ? "snapshot" : "live",
    expense: cardAndBarSnapshot ? "snapshot" : "live",
    disease: graphSnapshot ? "snapshot" : "live",
    dm: graphSnapshot ? "snapshot" : "live",
    ca: graphSnapshot ? "snapshot" : "live",
  };
}

function buildCases(fixtures = []) {
  if (!Array.isArray(fixtures)) throw new TypeError("fixtures must be an array");
  const cases = [];
  const add = (item) => {
    const testCase = {
      clock: NORMAL_CLOCK,
      timeZone: NORMAL_TIME_ZONE,
      variant: "normal",
      timing: false,
      ...item,
      body: { ...item.body },
      families: [...new Set([...item.families, ...(item.expectedError ? ["errors"] : []), "response-shape-and-order"])],
    };
    testCase.expectedSources = expectedSources(testCase.body, testCase.clock);
    cases.push(testCase);
  };

  for (const fixture of fixtures) {
    if (!fixture.id || !fixture.body) throw new TypeError("fixture requires id and body");
    add({
      id: fixture.id,
      description: fixture.description,
      families: FIXTURE_FAMILIES[fixture.id] || ["fixed-fixture"],
      body: fixture.body,
      clock: fixture.clock || NORMAL_CLOCK,
      timeZone: fixture.timeZone || fixture.timezone || NORMAL_TIME_ZONE,
      documentIds: fixture.documentIds || [],
      ...(fixture.handCheck ? { handCheck: fixture.handCheck } : {}),
      ...(fixture.expectedError ? { expectedError: fixture.expectedError } : {}),
    });
  }

  const scopes = [
    ["national-longest", {}, true],
    ["health-area", { ...EMPTY_GEO, area: "SYN-A01" }],
    ["province", { ...EMPTY_GEO, province: "SYN-P01" }],
    ["district", { ...EMPTY_GEO, district: "SYN-D01" }],
    ["hospital", { ...EMPTY_GEO, hcode: "SYN-H01" }],
    ["no-matching-scope", { ...EMPTY_GEO, hcode: "SYN-H-NO-MATCH" }],
  ];
  for (const [id, geography, timing = false] of scopes) {
    add({
      id,
      families: [
        "geographic-scope",
        "date-ranges",
        ...(id === "national-longest" ? ["cid-reuse", "graph-periods", "empty-and-sparse-data"] : []),
        ...(id === "no-matching-scope" ? ["empty-and-sparse-data"] : []),
      ],
      body: { ...FULL_RANGE, ...geography },
      timing,
    });
  }

  const ranges = [
    ["one-calendar-year", "2025-01-01", "2025-12-31"],
    ["partial-month", "2026-09-10", "2026-09-20"],
    ["partial-years", "2024-10-15", "2026-03-16"],
    ["leap-day-midnight", "2024-02-29", "2024-02-29"],
    ["month-boundary", "2026-09-30", "2026-10-01"],
    ["year-boundary", "2025-12-31", "2026-01-01"],
  ];
  for (const [id, startDate, endDate] of ranges) {
    add({
      id,
      families: ["date-ranges", "date-boundaries"],
      body: { startDate, endDate, hcode: "SYN-H20" },
    });
  }

  // Each field gets its own exact JSON input. In particular, omitted fields
  // cannot be replaced by empty strings before sending the requests.
  const filterValues = [
    ["omitted", undefined],
    ["empty-string", ""],
    ["null", null],
    ["false", false],
    ["numeric-zero", 0],
    ["string-zero", "0"],
    ["whitespace", " "],
  ];
  for (const field of GEO_FIELDS) {
    for (const [label, value] of filterValues) {
      const body = { ...FULL_RANGE, ...EMPTY_GEO };
      if (label === "omitted") delete body[field];
      else body[field] = value;
      add({
        id: `filter-${field}-${label}`,
        families: ["filter-presence-and-types", "geographic-scope"],
        body,
        // With all four exact empty strings, graphs read the stored snapshot.
        variant: label === "empty-string" ? "snapshot-valid" : "normal",
      });
    }
  }

  const boundaryClocks = [
    ["leap-day", "2024-02-29T05:00:00.000Z"],
    ["before-local-month", "2026-09-30T16:59:59.999Z"],
    ["at-local-month", "2026-09-30T17:00:00.000Z"],
    ["before-local-year", "2025-12-31T16:59:59.999Z"],
    ["at-local-year", "2025-12-31T17:00:00.000Z"],
    ["before-utc-midnight", "2026-10-12T23:59:59.999Z"],
    ["at-utc-midnight", "2026-10-13T00:00:00.000Z"],
  ];
  for (const [label, clock] of boundaryClocks) {
    for (const timeZone of [NORMAL_TIME_ZONE, "UTC"]) {
      add({
        id: `clock-${label}-${timeZone === "UTC" ? "utc" : "bangkok"}`,
        families: ["graph-periods", "date-boundaries"],
        body: { ...FULL_RANGE, hcode: "SYN-H24" },
        clock,
        timeZone,
      });
    }
  }

  for (const [id, ignoredInputs] of [
    ["graph-period-without-request-dates", {}],
    ["graph-ignores-old-dates-and-year", { startDate: "2024-01-01", endDate: "2024-01-02", year: 2024 }],
    ["graph-ignores-future-dates-and-year", { startDate: "2030-01-01", endDate: "2030-12-31", year: "2030" }],
  ]) {
    add({
      id,
      families: ["graph-periods", "empty-and-sparse-data"],
      body: { hcode: "SYN-H24", ...ignoredInputs },
    });
  }

  for (const variant of ["empty", "empty-patients"]) {
    add({
      id: variant === "empty" ? "empty-collection" : "controlled-empty-patients-positive-scalars",
      families: ["empty-and-sparse-data", "bar-calculations", ...(variant === "empty-patients" ? ["errors"] : [])],
      body: { ...FULL_RANGE },
      variant,
      ...(variant === "empty-patients" ? { expectedError: ["card"] } : {}),
    });
  }
  add({
    id: "failed-aggregation",
    families: ["errors", "empty-and-sparse-data"],
    body: { ...FULL_RANGE },
    fault: "aggregate",
    expectedError: true,
  });

  const snapshotBody = { startDate: "2024-01-07", endDate: "2026-10-13", ...EMPTY_GEO };
  for (const variant of ["snapshot-valid", "snapshot-stale", "snapshot-missing"]) {
    add({
      id: variant,
      families: ["stored-snapshots", ...(variant === "snapshot-missing" ? ["errors"] : [])],
      body: snapshotBody,
      variant,
      timing: variant === "snapshot-valid",
      ...(variant === "snapshot-missing" ? { expectedError: true } : {}),
    });
  }

  for (const { label, geography } of [
    { label: "false", geography: Object.fromEntries(GEO_FIELDS.map((field) => [field, false])) },
    { label: "numeric-zero", geography: Object.fromEntries(GEO_FIELDS.map((field) => [field, 0])) },
    { label: "mixed-loose-empty", geography: { area: "", province: false, district: 0, hcode: "" } },
  ]) {
    add({
      id: `snapshot-loose-filters-${label}`,
      families: ["stored-snapshots", "filter-presence-and-types"],
      body: { ...snapshotBody, ...geography },
      variant: "snapshot-valid",
    });
  }
  for (const field of GEO_FIELDS) {
    for (const [label, value] of filterValues) {
      if (["empty-string", "false", "numeric-zero"].includes(label)) continue;
      const body = { ...snapshotBody };
      if (label === "omitted") delete body[field];
      else body[field] = value;
      add({
        id: `snapshot-bypass-${field}-${label}`,
        families: ["stored-snapshots", "filter-presence-and-types"],
        body,
        variant: "snapshot-valid",
      });
    }
  }

  for (const [label, clock] of boundaryClocks.filter(([label]) => label.includes("utc-midnight"))) {
    for (const timeZone of [NORMAL_TIME_ZONE, "UTC"]) {
      add({
        id: `snapshot-utc-routing-${label}-${timeZone === "UTC" ? "utc" : "bangkok"}`,
        families: ["stored-snapshots", "graph-periods", "date-boundaries"],
        body: snapshotBody,
        clock,
        timeZone,
        variant: "snapshot-valid",
      });
    }
  }

  const ids = cases.map((testCase) => testCase.id);
  if (new Set(ids).size !== ids.length) throw new Error("Comparison case IDs must be unique");
  return cases;
}

function buildFamilyMap(cases) {
  const map = Object.fromEntries(REQUIRED_FAMILIES.map((family) => [family, []]));
  for (const testCase of cases) {
    for (const family of testCase.families) {
      (map[family] ||= []).push(testCase.id);
    }
  }
  return map;
}

module.exports = {
  NORMAL_CLOCK,
  NORMAL_TIME_ZONE,
  REQUIRED_FAMILIES,
  buildCases,
  buildFamilyMap,
  expectedSources,
};
