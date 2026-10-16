const { responseMetadata, responseResult } = require("../patients/read-model/metadata");
const { selectPatientsBackend, ReadModelUnavailableError } = require("../patients/backend");
const { cardServiceV2 } = require("./card.service");

async function cardController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    responseMetadata(res);
    const backend = selectPatientsBackend("card", req, res);
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
        ? await require("../patients/read-model/card").readCard(backend.reader, body)
        : await cardServiceV2(body);
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

module.exports = { cardController };
