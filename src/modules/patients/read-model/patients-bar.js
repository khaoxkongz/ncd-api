const { CATEGORIES } = require("./schema");
const { ReadModelUnavailableError } = require("../backend");

function present(facts) {
  return CATEGORIES.slice(0, 6).map(({ label }, index) => ({
    diseaseName: label,
    qtyOfPatient: facts.counts[index],
    avg:
      facts.counts[index] > 0
        ? Number(([facts.services[index]].reduce((a, b) => a + b, 0) / facts.counts[index]).toFixed(2))
        : 0,
  }));
}

async function readPatientsBar(reader, body) {
  const clock = new Date();
  const today = clock.toISOString().split("T")[0];
  let snapshot, selection;
  try {
    snapshot =
      body.startDate == "2024-01-07" &&
      body.endDate == today &&
      body.area == "" &&
      body.province == "" &&
      body.district == "" &&
      body.hcode == "";
  } catch {
    // Preserve the existing service's omitted-result input-coercion response.
    // These are validation semantics before any model read is attempted.
    return undefined;
  }
  // Keep the exact repository's string interpolation, inclusive dates and
  // independent truthy predicates. In particular, operator-valued predicates
  // retain Mongo query semantics; they are not converted into scalar equality.
  if (!snapshot) {
    try {
      selection = {
        date: { $gte: new Date(`${body.startDate}`), $lte: new Date(`${body.endDate}`) },
        ...Object.fromEntries(
          ["area", "province", "district", "hcode"].filter((field) => body[field]).map((field) => [field, body[field]])
        ),
      };
    } catch {
      // The legacy repository promises reject before its try block for this
      // input; the existing service applies all six explicit zero defaults.
      return present({ counts: [0, 0, 0, 0, 0, 0], services: [0, 0, 0, 0, 0, 0] });
    }
  }
  try {
    return await reader.read(
      {
        route: snapshot ? "patients-bar/snapshot" : "patients-bar/live",
        rangeRoute: "daily-range/live",
        clock,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        backendMode: "candidate-validation",
        timeoutMS: 60000,
      },
      async ({ rangeFacts, snapshot: selectedSnapshot }) => {
        if (snapshot) return selectedSnapshot("patients-bar");
        return present(await rangeFacts(selection));
      }
    );
  } catch {
    throw new ReadModelUnavailableError();
  }
}

module.exports = { readPatientsBar };
