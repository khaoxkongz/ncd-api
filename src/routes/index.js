const express = require("express");

const router = express.Router();

const chartExpenseRouter = require("../modules/bar-chart/expense/chart-ex.routes");
const chartPatientRouter = require("../modules/bar-chart/patients/chart-pt.routes");
const cardRouter = require("../modules/card-summary/card.routes");
const dropdownRouter = require("../modules/filter-bar/filter.routes");
const caExpenseRouter = require("../modules/graph/ca-expense/ca-ex.routes");
const caPatientRouter = require("../modules/graph/ca-patients/ca-pt.routes");
const diseaseExpenseRouter = require("../modules/graph/disease-expense/disease-ex.routes");
const diseasePatientRouter = require("../modules/graph/disease-patients/disease-pt.routes");
const dmExpenseRouter = require("../modules/graph/dm-expense/dm-ex.routes");
const dmPatientRouter = require("../modules/graph/dm-patients/dm-pt.routes");
const migrationRouter = require("../modules/migration/migration.routes");
const tempTableRouter = require("../modules/migration-temp-table/temp-table.routes");

const route = [
  cardRouter,
  chartPatientRouter,
  chartExpenseRouter,
  diseasePatientRouter,
  diseaseExpenseRouter,
  dmPatientRouter,
  dmExpenseRouter,
  migrationRouter,
  dropdownRouter,
  caPatientRouter,
  caExpenseRouter,
  tempTableRouter,
];

route.forEach((route) => {
  router.use("/", route);
});

module.exports = router;
