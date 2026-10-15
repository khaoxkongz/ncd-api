const { CATEGORIES } = require("./schema");
const { ZERO, roundedNumber } = require("./expense");
const { ReadModelUnavailableError } = require("../backend");

function present(facts) {
  return CATEGORIES.slice(0, 6).map(({ label }, index) => ({
    diseaseName: label,
    qtyOfExpense: roundedNumber(facts.expenseTotals[index]),
    avg: facts.counts[index] > 0 ? roundedNumber(facts.expenseTotals[index], facts.counts[index]) : 0,
  }));
}

async function readExpenseBar(reader, body) {
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
    return { result: undefined };
  }
  if (!snapshot) {
    try {
      selection = {
        date: { $gte: new Date(`${body.startDate}`), $lte: new Date(`${body.endDate}`) },
        ...Object.fromEntries(
          ["area", "province", "district", "hcode"].filter((field) => body[field]).map((field) => [field, body[field]])
        ),
      };
    } catch {
      // Preserve the existing service defaults for pre-read coercion errors.
      return { result: present({ counts: [0, 0, 0, 0, 0, 0], expenseTotals: Array(6).fill(ZERO) }) };
    }
  }
  try {
    return await reader.read(
      {
        route: snapshot ? "expense-bar/snapshot" : "expense-bar/live",
        rangeRoute: "daily-range/live",
        clock,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        backendMode: "candidate-validation",
        timeoutMS: 60000,
      },
      async ({ rangeFacts, snapshot: selectedSnapshot }) => {
        if (snapshot) return selectedSnapshot("expense-bar");
        const facts = await rangeFacts(selection);
        return { result: present(facts), source: facts.source };
      }
    );
  } catch {
    throw new ReadModelUnavailableError();
  }
}

module.exports = { readExpenseBar, present };
