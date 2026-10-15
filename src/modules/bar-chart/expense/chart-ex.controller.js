const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { chartExpenseServiceV2 } = require("./chart-ex.service");

async function chartExpenseController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    const backend = selectPatientsBackend("expense-bar");
    const body = {
      startDate,
      endDate,
      area,
      province,
      district,
      hcode,
    };
    const result =
      backend.mode === "candidate-validation"
        ? await require("../../patients/read-model/expense-bar").readExpenseBar(backend.reader, body)
        : await chartExpenseServiceV2(body);
    return res.status(200).json({
      status: true,
      message: "success",
      result,
    });
  } catch (error) {
    if (error instanceof ReadModelUnavailableError) {
      return res.status(503).json({ status: false, message: "Read model unavailable" });
    }
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

module.exports = { chartExpenseController };
