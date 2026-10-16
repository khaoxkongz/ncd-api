const { responseMetadata, responseResult } = require("../../patients/read-model/metadata");
const { selectPatientsBackend, ReadModelUnavailableError } = require("../../patients/backend");
const { dmPatientServiceV2 } = require("./dm-pt.service");

async function dmPatientController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    responseMetadata(res);
    const backend = selectPatientsBackend("patients-graphs", req, res);
    const body = {
      area,
      province,
      district,
      hcode,
    };
    const response =
      backend.mode !== "legacy"
        ? await require("../../patients/read-model/graphs").readGraph(backend.reader, "dm", body)
        : await dmPatientServiceV2(body);
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

module.exports = { dmPatientController };
