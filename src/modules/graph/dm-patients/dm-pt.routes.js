const { Router } = require("express");

const router = Router();

const { dmPatientController } = require("./dm-pt.controller");

/**
 * @openapi
 * /ncds_api/api/v1/graph-dm-pt:
 *   post:
 *     tags:
 *       - Diabetes Patient Graph
 *     summary: ข้อมูลจำนวนผู้ป่วยโรคเบาหวานแต่ละประเภท
 *     description: ดึงข้อมูลจำนวนผู้ป่วยโรคเบาหวานประเภทต่างๆ (ภาวะน้ำตาลในเลือดสูง ร่วมกับโรคไตเรื้อรัง ร่วมกับโรคหัวใจขาดเลือด ร่วมกับโรคหลอดเลือดสมอง) โดยกรองตามพื้นที่ จังหวัด อำเภอ และรหัสโรงพยาบาล
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
 *                         example: เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง
 *                       data:
 *                         type: array
 *                         items:
 *                           type: number
 *                         description: Monthly patient counts for 12 months
 *                         example: [0, 123, 234]
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
router.post("/graph-dm-pt", dmPatientController);

module.exports = router;
