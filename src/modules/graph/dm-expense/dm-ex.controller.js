const { dmExpenseService } = require("./dm-ex.service");

async function dmExpenseController(req, res) {
  const { area, province, district, hcode } = req.body;
  try {
    const result = await dmExpenseService({ area, province, district, hcode });
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

module.exports = { dmExpenseController };
