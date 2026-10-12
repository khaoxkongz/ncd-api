const { Router } = require("express");

const router = Router();

const { chartPatientController, tempChartPatientController } = require("./chart-pt.controller");

/**
 * @openapi
 * /ncds_api/api/v1/bar-chart-pt:
 *   post:
 *     summary: Get patient data for different diseases
 *     description: Retrieves aggregated patient counts and visit averages for various diseases based on the provided filters
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
 *                       qtyOfPatient:
 *                         type: number
 *                         description: Total number of unique patients
 *                         example: 150
 *                       avg:
 *                         type: string
 *                         description: Average number of visits per patient
 *                         example: "2.50"
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
router.post("/bar-chart-pt", chartPatientController);
router.post("/temp-bar-chart-pt", tempChartPatientController);

module.exports = router;
