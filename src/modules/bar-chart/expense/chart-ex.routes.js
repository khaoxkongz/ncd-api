const { Router } = require("express");

const router = Router();

const { chartExpenseController } = require("./chart-ex.controller");

/**
 * @openapi
 * /ncds_api/api/v1/bar-chart-ex:
 *   post:
 *     summary: Get expense data for different diseases
 *     description: Retrieves aggregated expense data and averages for various diseases based on the provided filters
 *     tags:
 *       - Bar Charts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: Start date for the data range
 *                 example: "2024-01-01"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 description: End date for the data range
 *                 example: "2024-12-31"
 *               area:
 *                 type: string
 *                 description: Area filter (optional)
 *               province:
 *                 type: string
 *                 description: Province filter (optional)
 *               district:
 *                 type: string
 *                 description: District filter (optional)
 *               hcode:
 *                 type: string
 *                 description: Hospital code filter (optional)
 *     responses:
 *       200:
 *         description: Successful operation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: success
 *                 result:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       diseaseName:
 *                         type: string
 *                         example: โรคเบาหวาน
 *                       qtyOfExpense:
 *                         type: string
 *                         example: "1234.56"
 *                       avg:
 *                         type: string
 *                         example: "123.45"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Internal server error
 */
router.post("/bar-chart-ex", chartExpenseController);

module.exports = router;
