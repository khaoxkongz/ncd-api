const migrationService = require("./migration.service");

async function migrate(_req, res) {
  try {
    await migrationService.processAllTransactions();
    return res.status(200).json({ success: true, message: "Successfully processed all transactions!" }).end();
  } catch (error) {
    console.error("Failed to process transactions" + error);
    return res.status(500).json({ success: false, message: "Internal server error" }).end();
  }
}

module.exports = {
  migrate,
};
