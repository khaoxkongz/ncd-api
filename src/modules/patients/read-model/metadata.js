const FRESHNESS_MS = 86400000;
const EXPOSED = ["X-NCD-Source-Cut", "X-NCD-Data-State"];

// This describes the effective facts/view, never the time the process built or
// served it. Unknown provenance is explicit and does not inherit a new cut.
function sourceState(provenance, clock) {
  const time = provenance?.sourceCutAt;
  const parsed = typeof time === "string" ? new Date(time) : null;
  const sourceCutAt = parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  const age = sourceCutAt ? clock.getTime() - parsed.getTime() : NaN;
  return Object.freeze({
    sourceCutAt,
    state:
      provenance?.coverageVerified === true && Number.isFinite(age) && age >= 0
        ? age <= FRESHNESS_MS
          ? "fresh"
          : "stale"
        : "unknown",
  });
}

function generationProvenance(generation) {
  const cut = generation.source?.sourceCutAt;
  const date = typeof cut === "string" || cut instanceof Date ? new Date(cut) : null;
  return {
    sourceCutAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    coverageVerified:
      generation.source?.rawComplete === true &&
      generation.source.complete === true &&
      generation.source.consistency === "producer-sealed-full-export" &&
      generation.source.domain?.allSupportedHistory === true,
  };
}

function responseMetadata(res, source = { sourceCutAt: null, state: "unknown" }) {
  const current = res.getHeader("Access-Control-Expose-Headers");
  const headers = (Array.isArray(current) ? current : [current ?? ""]).flatMap((value) => String(value).split(","));
  const exposed = new Map(
    headers
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => [value.toLowerCase(), value])
  );
  for (const name of EXPOSED) exposed.set(name.toLowerCase(), name);
  res.setHeader("Access-Control-Expose-Headers", [...exposed.values()].join(", "));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-NCD-Data-State", source.state);
  res.removeHeader("X-NCD-Source-Cut");
  if (source.sourceCutAt) res.setHeader("X-NCD-Source-Cut", source.sourceCutAt);
}

// Only backend adapters/controllers use this envelope. The HTTP body keeps its
// existing result shape; no generation or dictionary token enters the protocol.
function responseResult(res, envelope) {
  responseMetadata(res, envelope.source);
  return envelope.result;
}

module.exports = { sourceState, generationProvenance, responseMetadata, responseResult };
