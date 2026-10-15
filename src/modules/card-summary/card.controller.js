const { selectPatientsBackend, ReadModelUnavailableError } = require("../patients/backend");
const { cardServiceV2 } = require("./card.service");

async function cardController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    selectPatientsBackend();
    const result = await cardServiceV2({
      startDate,
      endDate,
      area,
      province,
      district,
      hcode,
    });
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

module.exports = { cardController };
