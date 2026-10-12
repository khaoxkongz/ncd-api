const { Router } = require("express");

const router = Router();

const { diseaseExpenseController } = require("./disease-ex.controller");

/**
 * @openapi
 * /ncds_api/api/v1/graph-disease-ex:
 *   post:
 *     tags:
 *       - Disease Expense Graph
 *     summary: ข้อมูลค่าใช้จ่ายของผู้ป่วยโรคไม่ติดต่อเรื้อรังแต่ละประเภท
 *     description: ดึงข้อมูลค่าใช้จ่ายของผู้ป่วยโรคไม่ติดต่อเรื้อรังประเภทต่างๆ (เบาหวาน ความดันโลหิตสูง ปอดอุดกั้นเรื้อรัง มะเร็ง สุขภาพจิต โรคหัวใจและหลอดเลือด) โดยกรองตามพื้นที่ จังหวัด อำเภอ และรหัสโรงพยาบาล
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               area:
 *                 type: string
 *                 description: Area filter
 *               province:
 *                 type: string
 *                 description: Province filter
 *               district:
 *                 type: string
 *                 description: District filter
 *               hcode:
 *                 type: string
 *                 description: Hospital code filter
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
 *                       data:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Monthly expense values for 12 months (fixed to 2 decimal places)
 *                         example: ["0.00", "1234.56", "2345.67"]
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
router.post("/graph-disease-ex", diseaseExpenseController);

module.exports = router;
