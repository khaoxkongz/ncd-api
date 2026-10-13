/* eslint-disable prettier/prettier */
function parseBody(body) {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  const visit = (value) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) throw new TypeError("Response body contains a sparse array");
        visit(value[i]);
      }
      return;
    }
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      for (const child of Object.values(value)) visit(child);
      return;
    }
    throw new TypeError("Response body must be parsed JSON with finite numbers");
  };
  visit(parsed);
  return parsed;
}

function compareResponses(reference, candidate) {
  for (const response of [reference, candidate]) {
    if (!response || !Object.hasOwn(response, "status") || !Object.hasOwn(response, "body")) {
      throw new TypeError("Captured responses require HTTP status and body");
    }
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new TypeError("Captured response HTTP status must be an integer from 100 to 599");
    }
  }
  const differences = [];
  const type = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  const compare = (left, right, path) => {
    if (type(left) !== type(right)) {
      differences.push({ path, kind: "type", reference: left, candidate: right });
      return;
    }
    if (Array.isArray(left)) {
      if (left.length !== right.length) {
        differences.push({ path, kind: "array-length", reference: left.length, candidate: right.length });
      }
      for (let i = 0; i < Math.min(left.length, right.length); i++) compare(left[i], right[i], `${path}[${i}]`);
    } else if (left !== null && typeof left === "object") {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const childPath = `${path}[${JSON.stringify(key)}]`;
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
          differences.push({
            path: childPath,
            kind: "missing-field",
            referencePresent: Object.hasOwn(left, key),
            candidatePresent: Object.hasOwn(right, key),
            ...(Object.hasOwn(left, key) ? { reference: left[key] } : {}),
            ...(Object.hasOwn(right, key) ? { candidate: right[key] } : {}),
          });
        } else compare(left[key], right[key], childPath);
      }
    } else if (!Object.is(left, right)) {
      differences.push({ path, kind: "value", reference: left, candidate: right });
    }
  };
  compare(reference.status, candidate.status, "$status");
  compare(parseBody(reference.body), parseBody(candidate.body), "$body");
  return { equal: differences.length === 0, differences };
}

function assertSameResponse(reference, candidate, label = "Response") {
  const result = compareResponses(reference, candidate);
  if (!result.equal) {
    const error = new Error(`${label} differs from its reference at ${result.differences[0].path}`);
    error.differences = result.differences;
    throw error;
  }
  return result;
}

function nearestRank(samples, percentile = 0.95) {
  if (!Array.isArray(samples)) throw new TypeError("samples must be an array");
  if (!(percentile > 0 && percentile <= 1)) throw new RangeError("percentile must be greater than 0 and at most 1");
  if (samples.some((sample) => typeof sample !== "number" || Number.isNaN(sample) || sample < 0)) {
    throw new TypeError("durations must be nonnegative numbers or positive infinity");
  }
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function summarizeAttempts(attempts, { targetMs = 15000, requiredAttempts = 100 } = {}) {
  if (!Array.isArray(attempts)) throw new TypeError("attempts must be an array");
  if (!Number.isFinite(targetMs) || targetMs < 0) throw new RangeError("targetMs must be nonnegative and finite");
  if (!Number.isInteger(requiredAttempts) || requiredAttempts <= 0)
    throw new RangeError("requiredAttempts must be a positive integer");
  const samples = attempts.map((attempt, index) => {
    const reasons = [];
    if (attempt.correct !== true) reasons.push("response comparison did not pass");
    if (attempt.complete !== true) reasons.push("load did not complete");
    if (attempt.errorEvidenceVerified !== true) reasons.push("query error evidence is unverified");
    if (!Array.isArray(attempt.queryErrors)) reasons.push("query error evidence is missing");
    else if (attempt.queryErrors.length > 0) reasons.push("query failed");
    if (attempt.error || attempt.timedOut) reasons.push("request failed or timed out");
    if (!Number.isFinite(attempt.durationMs) || attempt.durationMs < 0) reasons.push("elapsed duration is unavailable");
    const successful = reasons.length === 0;
    return {
      ...attempt,
      attempt: index + 1,
      successful,
      failureReasons: reasons,
      effectiveDurationMs: successful ? attempt.durationMs : "Infinity",
    };
  });
  const attempted = samples.length;
  const correctComplete = samples.filter((sample) => sample.successful).length;
  const withinTarget = samples.filter((sample) => sample.successful && sample.durationMs <= targetMs).length;
  const p95 = nearestRank(samples.map((sample) => (sample.successful ? sample.durationMs : Infinity)));
  const passFraction = attempted ? withinTarget / attempted : 0;
  return {
    attempted,
    requiredAttempts,
    sufficientSamples: attempted === requiredAttempts,
    correctComplete,
    failed: attempted - correctComplete,
    withinTarget,
    targetMs,
    passFraction,
    p95Rank: attempted ? Math.ceil(0.95 * attempted) : null,
    p95Ms: p95 === Infinity ? "Infinity" : p95,
    timingPassed: attempted === requiredAttempts && passFraction >= 0.95 && p95 !== null && p95 <= targetMs,
    samples,
  };
}

module.exports = { compareResponses, assertSameResponse, nearestRank, summarizeAttempts };
