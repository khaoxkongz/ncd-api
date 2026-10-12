const { chartExpenseServiceV2 } = require("./chart-ex.service");

async function chartExpenseController(req, res) {
  const { startDate, endDate, area, province, district, hcode } = req.body;
  try {
    const result = await chartExpenseServiceV2({
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
    console.error(error);
    return res
      .status(500)
      .json({ status: false, message: "Internal server error" });
  }
}

module.exports = { chartExpenseController };
