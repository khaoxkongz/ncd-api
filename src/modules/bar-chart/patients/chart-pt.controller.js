const { responseMetadata, responseResult } = require("../../patients/read-model/metadata");
const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { chartPatientServiceV2, tempChartPatientService } = require("./chart-pt.service");

async function chartPatientController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    responseMetadata(res);
    const backend = selectPatientsBackend("patients-bar", req, res);
    const body = {
      startDate,
      endDate,
      area,
      province,
      district,
      hcode,
    };
    const response =
      backend.mode !== "legacy"
        ? await require("../../patients/read-model/patients-bar").readPatientsBar(backend.reader, body)
        : await chartPatientServiceV2(body);
    const result = backend.mode !== "legacy" ? responseResult(res, response) : response;
    return res.status(200).json({
      status: true,
      message: "success",
      result,
    });
  } catch (error) {
    if (error instanceof ReadModelUnavailableError) {
      responseMetadata(res);
      return res.status(503).json({ status: false, message: "Read model unavailable" });
    }
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

async function tempChartPatientController(req, res) {
  try {
    const result = await tempChartPatientService();
    return res.status(200).json({
      status: true,
      message: "success",
      result,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

module.exports = { chartPatientController, tempChartPatientController };
