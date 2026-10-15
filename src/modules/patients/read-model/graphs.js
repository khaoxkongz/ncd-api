const { CATEGORIES } = require("./schema");
const { storedPeriods } = require("./stored-months");
const { ReadModelUnavailableError } = require("../backend");

const DM_LABELS = [
  "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
  "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
  "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
  "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
];
const CA_LABELS = ["โรคมะเร็งปอด", "โรคมะเร็งเต้านม", "โรคมะเร็งปากมดลูก", "โรคมะเร็งตับ", "โรคมะเร็งลำไส้ใหญ่"];

function present(graph, { counts }) {
  if (graph === "disease")
    return [
      { diseaseName: "ทั้งหมด", data: counts.map((row) => row.slice(0, 6).reduce((total, value) => total + value, 0)) },
      ...CATEGORIES.slice(0, 6).map(({ label }, column) => ({
        diseaseName: label,
        data: counts.map((row) => row[column]),
      })),
    ];
  const dm = graph === "dm";
  const labels = dm ? DM_LABELS : CA_LABELS;
  const start = dm ? 6 : 10;
  const base = dm ? 0 : 3;
  return [
    ...labels.map((diseaseName, index) => ({ diseaseName, data: counts.map((row) => row[start + index]) })),
    {
      diseaseName: dm ? "เบาหวานชนิดอื่น ๆ" : "โรคมะเร็งชนิดอื่น ๆ",
      data: counts.map((row) =>
        Math.max(0, row[base] - row.slice(start, start + labels.length).reduce((sum, value) => sum + value, 0))
      ),
    },
  ];
}

async function readGraph(reader, graph, body) {
  const clock = new Date();
  const snapshot = ["area", "province", "district", "hcode"].every((field) => body[field] === "");
  const scope = Object.fromEntries(
    ["area", "province", "district", "hcode"].filter((field) => body[field]).map((field) => [field, body[field]])
  );
  try {
    return await reader.read(
      {
        // All three live adapters consume exactly the same facts. Snapshot route
        // identity stays separate, including the selected endpoint view.
        route: snapshot ? `patients-graphs/snapshot/${graph}` : "patients-graphs/live",
        clock,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        backendMode: "candidate-validation",
        timeoutMS: 60000,
      },
      async ({ monthFacts, snapshot: selectedSnapshot }) =>
        snapshot ? selectedSnapshot(`${graph}-patients`) : present(graph, await monthFacts(scope, storedPeriods(clock)))
    );
  } catch {
    throw new ReadModelUnavailableError();
  }
}

module.exports = { readGraph };
