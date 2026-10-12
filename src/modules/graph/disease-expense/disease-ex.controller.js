const { diseaseExpenseService } = require("./disease-ex.service");

async function diseaseExpenseController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    const result = await diseaseExpenseService({
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
    console.error(error);
    return res
      .status(500)
      .json({ status: false, message: "Internal server error" });
  }
}

module.exports = { diseaseExpenseController };
