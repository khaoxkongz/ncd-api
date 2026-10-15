const expense = require("./expense");
const { ReadModelUnavailableError } = require("../backend");

function present(facts) {
  if (facts.cardServiceError || (!facts.empty && facts.cardPatientCount === 0))
    throw new Error("Baseline Card presentation failed");
  const total = facts.expenseTotals.reduce(expense.add, expense.ZERO);
  return [
    {
      service_count: facts.cardService || 0,
      patient_count: facts.cardPatientCount,
      expense: expense.roundedNumber(total),
      hcode_count: facts.hospitalCount,
      avg_service: facts.cardPatientCount > 0 ? Number((facts.cardService / facts.cardPatientCount).toFixed(2)) : 0,
      avg_expense: facts.cardPatientCount > 0 ? expense.roundedNumber(total, facts.cardPatientCount) : 0,
    },
  ];
}

async function readCard(reader, body) {
  const clock = new Date();
  const today = clock.toISOString().split("T")[0];
  // Card propagates pre-read coercion errors to its existing generic HTTP 500.
  const snapshot =
    body.startDate == "2024-01-07" &&
    body.endDate == today &&
    body.area == "" &&
    body.province == "" &&
    body.district == "" &&
    body.hcode == "";
  const selection = snapshot
    ? undefined
    : {
        date: { $gte: new Date(`${body.startDate}`), $lte: new Date(`${body.endDate}`) },
        ...Object.fromEntries(
          ["area", "province", "district", "hcode"].filter((field) => body[field]).map((field) => [field, body[field]])
        ),
      };
  let facts;
  try {
    facts = await reader.read(
      {
        route: snapshot ? "card/snapshot" : "card/live",
        rangeRoute: "daily-range/live",
        clock,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        backendMode: "candidate-validation",
        timeoutMS: 60000,
      },
      ({ rangeFacts, snapshot: selectedSnapshot }) => (snapshot ? selectedSnapshot("card") : rangeFacts(selection))
    );
  } catch {
    throw new ReadModelUnavailableError();
  }
  if (snapshot) return facts;
  try {
    return { result: present(facts), source: facts.source };
  } catch (error) {
    if (error.message === "Baseline Card presentation failed") throw error;
    throw new ReadModelUnavailableError();
  }
}

module.exports = { readCard, present };
