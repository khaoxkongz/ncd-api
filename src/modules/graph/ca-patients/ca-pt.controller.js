const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { caPatientServiceV2 } = require("./ca-pt.service");

async function caPatientController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    const backend = selectPatientsBackend("patients-graphs");
    const body = {
      area,
      province,
      district,
      hcode,
    };
    const result =
      backend.mode === "candidate-validation"
        ? await require("../../patients/read-model/graphs").readGraph(backend.reader, "ca", body)
        : await caPatientServiceV2(body);
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
