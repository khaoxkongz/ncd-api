const { Router } = require("express");

const router = Router();

const { caPatientController } = require("./ca-pt.controller");

/**
 * @openapi
 * /ncds_api/api/v1/graph-ca-pt:
 *   post:
 *     tags:
 *       - Cancer Patient Graph
 *     summary: ข้อมูลจำนวนผู้ป่วยโรคมะเร็งแต่ละประเภท
 *     description: ดึงข้อมูลจำนวนผู้ป่วยโรคมะเร็งประเภทต่างๆ (มะเร็งปอด มะเร็งเต้านม มะเร็งปากมดลูก มะเร็งตับ มะเร็งลำไส้ใหญ่) โดยกรองตามพื้นที่ จังหวัด อำเภอ และรหัสโรงพยาบาล
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
 *                         example: โรคมะเร็งปอด
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
router.post("/graph-ca-pt", caPatientController);

module.exports = router;
