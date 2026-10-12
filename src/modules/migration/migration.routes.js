const { Router } = require("express");

const router = Router();

const migrationCtrl = require("./migration.controller");

router.post("/migration", (req, res) => migrationCtrl.migrate(req, res));

module.exports = router;
