const { Router } = require("express");

const router = Router();

const { cardController } = require("./card.controller");

/**
 * @openapi
 * /ncds_api/api/v1/card:
 *   post:
 *     tags:
 *       - Card Summary
 *     summary: Get card summary data
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
 *               province:
 *                 type: string
 *               district:
 *                 type: string
 *               hcode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 result:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       service_count:
 *                         type: number
 *                       patient_count:
 *                         type: number
 *                       expense:
 *                         type: number
 *                       hcode_count:
 *                         type: number
 *                       avg_service:
 *                         type: number
 *                       avg_expense:
 *                         type: number
 */
router.post("/card", cardController);

module.exports = router;
