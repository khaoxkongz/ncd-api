const {
  countDmCid,
  countHtCid,
  countCopdCid,
  countCaCid,
  countPsyCid,
  countHdCvdCid,
} = require("../../shared/count-cid.repository");
const {
  chartExpenseRepository,
  chartExpenseRepositoryV2,
  getDataFromTempTable,
} = require("./chart-ex.repository");

async function chartExpenseService(body) {
  try {
    const result = await chartExpenseRepository(body);

    const finalResult = [
      {
        diseaseName: "โรคเบาหวาน",
        qtyOfExpense: Number(
          result
            .map((item) => item.dm_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.dm_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.dm_expense / item.dm_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        qtyOfExpense: Number(
          result
            .map((item) => item.ht_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.ht_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.ht_expense / item.ht_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        qtyOfExpense: Number(
          result
            .map((item) => item.copd_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.copd_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.copd_expense / item.copd_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคมะเร็ง",
        qtyOfExpense: Number(
          result
            .map((item) => item.ca_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.ca_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.ca_expense / item.ca_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "สุขภาพจิต",
        qtyOfExpense: Number(
          result
            .map((item) => item.psy_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.psy_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.psy_expense / item.psy_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        qtyOfExpense: Number(
          result
            .map((item) => item.hd_cvd_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg: result.some((item) => item.hd_cvd_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.hd_cvd_expense / item.hd_cvd_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process chart expense data:", error);
  }
}

async function chartExpenseServiceV2(body) {
  const endDate = new Date();
  const formattedDate = endDate.toISOString().split("T")[0];

  try {
    if (
      body.startDate == "2024-01-07" &&
      body.endDate == formattedDate &&
      body.area == "" &&
      body.province == "" &&
      body.district == "" &&
      body.hcode == ""
    ) {
      const result = await getDataFromTempTable();
      return result;
    }

    const [
      result = [],
      countDmPatient = { dm_cid_count: 0 },
      countHtPatient = { ht_cid_count: 0 },
      countCopdPatient = { copd_cid_count: 0 },
      countCaPatient = { ca_cid_count: 0 },
      countPsyPatient = { psy_cid_count: 0 },
      countHdCvdPatient = { hd_cvd_cid_count: 0 },
    ] = await Promise.all([
      chartExpenseRepositoryV2(body).catch(() => []),
      countDmCid(body).catch(() => ({ dm_cid_count: 0 })),
      countHtCid(body).catch(() => ({ ht_cid_count: 0 })),
      countCopdCid(body).catch(() => ({ copd_cid_count: 0 })),
      countCaCid(body).catch(() => ({ ca_cid_count: 0 })),
      countPsyCid(body).catch(() => ({ psy_cid_count: 0 })),
      countHdCvdCid(body).catch(() => ({ hd_cvd_cid_count: 0 })),
    ]);

    const finalResult = [
      {
        diseaseName: "โรคเบาหวาน",
        qtyOfExpense: Number(
          result
            .map((item) => item.dm_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countDmPatient.dm_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.dm_expense)
                    .reduce((a, b) => a + b, 0) / countDmPatient.dm_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        qtyOfExpense: Number(
          result
            .map((item) => item.ht_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countHtPatient.ht_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.ht_expense)
                    .reduce((a, b) => a + b, 0) / countHtPatient.ht_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        qtyOfExpense: Number(
          result
            .map((item) => item.copd_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countCopdPatient.copd_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.copd_expense)
                    .reduce((a, b) => a + b, 0) /
                  countCopdPatient.copd_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคมะเร็ง",
        qtyOfExpense: Number(
          result
            .map((item) => item.ca_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countCaPatient.ca_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.ca_expense)
                    .reduce((a, b) => a + b, 0) / countCaPatient.ca_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "สุขภาพจิต",
        qtyOfExpense: Number(
          result
            .map((item) => item.psy_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countPsyPatient.psy_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.psy_expense)
                    .reduce((a, b) => a + b, 0) / countPsyPatient.psy_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        qtyOfExpense: Number(
          result
            .map((item) => item.hd_cvd_expense)
            .reduce((a, b) => a + b, 0)
            .toFixed(2),
        ),
        avg:
          countHdCvdPatient.hd_cvd_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.hd_cvd_expense)
                    .reduce((a, b) => a + b, 0) /
                  countHdCvdPatient.hd_cvd_cid_count
                ).toFixed(2),
              )
            : 0,
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process chart expense data:", error);
  }
}

module.exports = { chartExpenseService, chartExpenseServiceV2 };
