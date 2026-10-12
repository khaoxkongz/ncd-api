const { Router } = require("express");

const router = Router();

const tempTableCtrl = require("./temp-table.controller");

router.post("/migration/temp-table", tempTableCtrl.tempTableController);

router.post("/migration/temp-chart-pt", tempTableCtrl.tempChartPtController);

module.exports = router;
