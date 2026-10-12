const { Router } = require("express");

const router = Router();

const { default: controllerFilterDropdown } = require("./filter.controller");

router.post("/dropdown-filter", controllerFilterDropdown.filterDropDown);
router.get("/dropdown-fiscal-year", controllerFilterDropdown.filterFiscalYearDropDown);
router.get("/date-update", controllerFilterDropdown.dateUpdate);
router.post("/get_health_office_detail", controllerFilterDropdown.getHealthOfficeDetail);

module.exports = router;
