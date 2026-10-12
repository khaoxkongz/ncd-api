const tempTableService = require("./temp-table.service");

async function tempTableController(_req, res) {
  try {
    await tempTableService.tempTableService();
    return res
      .status(200)
      .json({
        success: true,
        message: "Successfully processed all transactions!",
      })
      .end();
  } catch (error) {
    console.error("Failed to process transactions" + error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" })
      .end();
  }
}

async function tempChartPtController(_req, res) {
  try {
    await tempTableService.tempChartPtService();
    return res
      .status(200)
      .json({
        success: true,
        message: "Successfully processed all transactions!",
      })
      .end();
  } catch (error) {
    console.error("Failed to process transactions" + error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" })
      .end();
  }
}

module.exports = {
  tempTableController,
  tempChartPtController,
};
