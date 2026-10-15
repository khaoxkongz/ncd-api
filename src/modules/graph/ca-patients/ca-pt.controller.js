const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { caPatientServiceV2 } = require("./ca-pt.service");

async function caPatientController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    selectPatientsBackend();
    const result = await caPatientServiceV2({
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

module.exports = { caPatientController };
