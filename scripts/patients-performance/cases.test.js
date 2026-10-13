/* eslint-disable prettier/prettier */
import { describe, expect, it } from "vite-plus/test";
import casesModule from "./cases.cjs";
import comparison from "./compare.cjs";

const { buildCases, buildFamilyMap, REQUIRED_FAMILIES } = casesModule;
const { compareResponses, assertSameResponse, nearestRank, summarizeAttempts } = comparison;
const envelope = (result) => ({ status: 200, body: { status: true, message: "success", result } });
const successfulAttempt = (durationMs = 1000) => ({
  durationMs,
  correct: true,
  complete: true,
  queryErrors: [],
  errorEvidenceVerified: true,
});

describe("Patients response comparison", () => {
  it("ignores only object-key order and parses JSON text", () => {
    const response = envelope([{ diseaseName: "โรคเบาหวาน", qtyOfPatient: 2, avg: 1.25 }]);
    const reordered = {
      status: 200,
      body: '{"result":[{"avg":1.25,"qtyOfPatient":2,"diseaseName":"โรคเบาหวาน"}],"message":"success","status":true}',
    };
    expect(compareResponses(response, reordered)).toEqual({ equal: true, differences: [] });
  });

  it.each([
    ["HTTP status", { status: 500, body: envelope([1, 2]).body }],
    ["array order", envelope([2, 1])],
    ["array length", envelope([1, 2, 0])],
    ["numeric type", envelope(["1", 2])],
    ["numeric value without tolerance", envelope([1 + Number.EPSILON, 2])],
  ])("rejects a changed %s", (_label, candidate) => {
    expect(compareResponses(envelope([1, 2]), candidate).equal).toBe(false);
  });

  it("keeps omitted result and null distinct, and compares baseline errors", () => {
    const missing = { status: 200, body: { status: true, message: "success" } };
    expect(
      compareResponses(missing, { status: 200, body: { ...missing.body, result: null } }).differences[0].kind
    ).toBe("missing-field");
    expect(assertSameResponse(missing, { ...missing, body: JSON.stringify(missing.body) }).equal).toBe(true);
    expect(() => assertSameResponse(missing, envelope([]), "Expected suppressed error")).toThrow(
      "Expected suppressed error differs"
    );
  });

  it("requires actual JSON values instead of hiding nonfinite numbers or undefined fields", () => {
    expect(() => compareResponses(envelope([NaN]), envelope([null]))).toThrow("parsed JSON");
    expect(() => compareResponses(envelope([Infinity]), envelope([null]))).toThrow("parsed JSON");
    expect(() => compareResponses(envelope([undefined]), envelope([null]))).toThrow("parsed JSON");
    expect(() => compareResponses({ body: [] }, { body: [] })).toThrow("HTTP status and body");
    expect(() => compareResponses({ status: undefined, body: [] }, envelope([]))).toThrow("HTTP status must be");
    expect(compareResponses(envelope([0]), envelope([-0])).equal).toBe(false);
  });
});

describe("Patients attempt statistics", () => {
  it("uses nearest rank position 19 of 20 and 95 of 100 without changing raw order", () => {
    const samples = Array.from({ length: 20 }, (_, index) => 20 - index);
    expect(nearestRank(samples)).toBe(19);
    expect(samples[0]).toBe(20);
    expect(nearestRank(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
    expect(nearestRank([])).toBeNull();
  });

  it("keeps failed, incomplete, and unverified loads in the denominator with infinity", () => {
    const attempts = Array.from({ length: 20 }, () => successfulAttempt());
    attempts[0] = { ...successfulAttempt(20), queryErrors: [{ message: "aggregation failed" }] };
    attempts[1] = { ...successfulAttempt(30), complete: false };
    attempts[2] = { ...successfulAttempt(40), errorEvidenceVerified: false };
    const result = summarizeAttempts(attempts, { requiredAttempts: 20 });
    expect(result.attempted).toBe(20);
    expect(result.withinTarget).toBe(17);
    expect(result.passFraction).toBe(0.85);
    expect(result.p95Ms).toBe("Infinity");
    expect(result.timingPassed).toBe(false);
    expect(result.samples[0].durationMs).toBe(20);
    expect(JSON.parse(JSON.stringify(result)).samples[0].effectiveDurationMs).toBe("Infinity");
  });

  it("counts the 15-second boundary and permits at most five failures in 100 acceptance attempts", () => {
    const attempts = Array.from({ length: 100 }, () => successfulAttempt(15000));
    for (let i = 0; i < 5; i++) attempts[i] = { ...successfulAttempt(1), correct: false };
    const result = summarizeAttempts(attempts);
    expect(result.p95Ms).toBe(15000);
    expect(result.passFraction).toBe(0.95);
    expect(result.timingPassed).toBe(true);
    attempts[5].timedOut = true;
    expect(summarizeAttempts(attempts).timingPassed).toBe(false);
  });

  it("does not let a partial run or HTTP 200 without error evidence establish acceptance", () => {
    expect(summarizeAttempts([successfulAttempt()]).timingPassed).toBe(false);
    expect(
      summarizeAttempts([{ durationMs: 1, correct: true, complete: true, status: 200, errorEvidenceVerified: true }], {
        requiredAttempts: 1,
      }).failed
    ).toBe(1);
    expect(() => nearestRank([NaN])).toThrow("durations");
  });
});

describe("Patients comparison case inventory", () => {
  it("preserves all seven exact geographic input forms for each field", () => {
    const cases = buildCases();
    for (const field of ["area", "province", "district", "hcode"]) {
      const find = (label) => cases.find((testCase) => testCase.id === `filter-${field}-${label}`).body;
      expect(Object.hasOwn(find("omitted"), field)).toBe(false);
      expect(find("empty-string")[field]).toBe("");
      expect(find("null")[field]).toBeNull();
      expect(find("false")[field]).toBe(false);
      expect(find("numeric-zero")[field]).toBe(0);
      expect(find("string-zero")[field]).toBe("0");
      expect(find("whitespace")[field]).toBe(" ");
    }
  });

  it("separates UTC cache dates from local graph clocks and loose from strict empty checks", () => {
    const cases = buildCases();
    const loose = cases.find((testCase) => testCase.id === "snapshot-loose-filters-mixed-loose-empty");
    expect(loose.expectedSources).toEqual({
      card: "snapshot",
      bar: "snapshot",
      disease: "live",
      dm: "live",
      ca: "live",
    });
    const before = cases.find((testCase) => testCase.id === "snapshot-utc-routing-before-utc-midnight-bangkok");
    expect(before.expectedSources.card).toBe("live");
    expect(before.expectedSources.disease).toBe("snapshot");
    const after = cases.find((testCase) => testCase.id === "snapshot-utc-routing-at-utc-midnight-bangkok");
    expect(after.expectedSources.card).toBe("snapshot");
    expect(cases.filter((testCase) => testCase.id.startsWith("clock-")).length).toBe(14);
  });

  it("links each accepted family to named conditions and keeps snapshot references separate", () => {
    const fixtureIds = [
      "arithmetic-overlap",
      "disease-sum-versus-union",
      "dm-ca-other-positive",
      "dm-ca-other-zero",
      "dm-ca-other-negative",
      "empty-patients-positive-scalars",
      "inclusive-partial-day-bounds",
      "graph-position-anchors",
    ];
    const fixtures = fixtureIds.map((id) => ({
      id,
      body: { startDate: "2024-01-01", endDate: "2026-10-13", hcode: "SYN-H24" },
      documentIds: [id],
    }));
    const cases = buildCases(fixtures);
    const map = buildFamilyMap(cases);
    for (const family of REQUIRED_FAMILIES) expect(map[family].length).toBeGreaterThan(0);
    expect(
      cases
        .filter((testCase) => ["snapshot-valid", "snapshot-stale", "snapshot-missing"].includes(testCase.id))
        .map((testCase) => testCase.variant)
    ).toEqual(["snapshot-valid", "snapshot-stale", "snapshot-missing"]);
    expect(cases.find((testCase) => testCase.id === "failed-aggregation").expectedError).toBe(true);
    expect(cases.find((testCase) => testCase.id === "national-longest").timing).toBe(true);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(cases.length);
    expect(() => buildCases([fixtures[0], fixtures[0]])).toThrow("IDs must be unique");
  });
});
