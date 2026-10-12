const {
  countDmCid,
  countHtCid,
  countCopdCid,
  countCaCid,
  countPsyCid,
  countHdCvdCid,
} = require("../../shared/count-cid.repository");
const {
  chartPatientRepository,
  chartPatientRepositoryV2,
  getDataFromTempTable,
  getDataFromTempChartPTTable,
} = require("./chart-pt.repository");

async function chartPatientService(body) {
  try {
    const result = await chartPatientRepository(body);

    const finalResult = [
      {
        diseaseName: "โรคเบาหวาน",
        qtyOfPatient: result
          .map((item) => item.dm_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.dm_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.dm_uid_count / item.dm_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        qtyOfPatient: result
          .map((item) => item.ht_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.ht_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.ht_uid_count / item.ht_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        qtyOfPatient: result
          .map((item) => item.copd_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.copd_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.copd_uid_count / item.copd_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคมะเร็ง",
        qtyOfPatient: result
          .map((item) => item.ca_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.ca_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.ca_uid_count / item.ca_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "สุขภาพจิต",
        qtyOfPatient: result
          .map((item) => item.psy_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.psy_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.psy_uid_count / item.psy_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        qtyOfPatient: result
          .map((item) => item.hd_cvd_cid_count)
          .reduce((a, b) => a + b, 0),
        avg: result.some((item) => item.hd_cvd_cid_count > 0)
          ? Number(
              (
                result
                  .map((item) => item.hd_cvd_uid_count / item.hd_cvd_cid_count)
                  .reduce((a, b) => a + b, 0) / result.length
              ).toFixed(2),
            )
          : 0,
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process chart patient data:", error);
  }
}

async function chartPatientServiceV2(body) {
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
      chartPatientRepositoryV2(body).catch(() => []),
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
        qtyOfPatient: countDmPatient.dm_cid_count,
        avg:
          countDmPatient.dm_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.dm_uid_count)
                    .reduce((a, b) => a + b, 0) / countDmPatient.dm_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        qtyOfPatient: countHtPatient.ht_cid_count,
        avg:
          countHtPatient.ht_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.ht_uid_count)
                    .reduce((a, b) => a + b, 0) / countHtPatient.ht_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        qtyOfPatient: countCopdPatient.copd_cid_count,
        avg:
          countCopdPatient.copd_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.copd_uid_count)
                    .reduce((a, b) => a + b, 0) /
                  countCopdPatient.copd_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคมะเร็ง",
        qtyOfPatient: countCaPatient.ca_cid_count,
        avg:
          countCaPatient.ca_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.ca_uid_count)
                    .reduce((a, b) => a + b, 0) / countCaPatient.ca_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "สุขภาพจิต",
        qtyOfPatient: countPsyPatient.psy_cid_count,
        avg:
          countPsyPatient.psy_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.psy_uid_count)
                    .reduce((a, b) => a + b, 0) / countPsyPatient.psy_cid_count
                ).toFixed(2),
              )
            : 0,
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        qtyOfPatient: countHdCvdPatient.hd_cvd_cid_count,
        avg:
          countHdCvdPatient.hd_cvd_cid_count > 0
            ? Number(
                (
                  result
                    .map((item) => item.hd_cvd_uid_count)
                    .reduce((a, b) => a + b, 0) /
                  countHdCvdPatient.hd_cvd_cid_count
                ).toFixed(2),
              )
            : 0,
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process chart patient data:", error);
  }
}

async function tempChartPatientService() {
  try {
    const result = await getDataFromTempChartPTTable();
    return result;
  } catch (error) {
    console.error("Failed to process chart patient data:", error);
  }
}

module.exports = {
  chartPatientService,
  chartPatientServiceV2,
  tempChartPatientService,
};
