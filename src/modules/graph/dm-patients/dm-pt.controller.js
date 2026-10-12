const { dmPatientServiceV2 } = require("./dm-pt.service");

async function dmPatientController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    const result = await dmPatientServiceV2({ area, province, district, hcode });
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

module.exports = { dmPatientController };
