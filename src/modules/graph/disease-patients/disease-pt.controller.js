const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { diseasePatientServiceV2 } = require("./disease-pt.service");

async function diseasePatientController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    selectPatientsBackend();
    const result = await diseasePatientServiceV2({
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

module.exports = { diseasePatientController };
