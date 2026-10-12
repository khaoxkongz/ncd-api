const { chartPatientServiceV2, tempChartPatientService } = require("./chart-pt.service");

async function chartPatientController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    const result = await chartPatientServiceV2({ startDate, endDate, area, province, district, hcode });
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
