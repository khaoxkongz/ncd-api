const {
  diseasePatientRepository,
  dmPatientCount,
  htPatientCount,
  copdPatientCount,
  caPatientCount,
  psyPatientCount,
  hdCvdPatientCount,
  getDataFromTempTable,
} = require("./disease-pt.repository");

async function diseasePatientService(body) {
  try {
    const result = await diseasePatientRepository(body);

    const fullMonths = Array.from({ length: 12 }, (_, i) => {
      const currentYear = i < 9 ? body.year : body.year + 1;
      const month = (i + 4) % 12 || 12;
      return { year: currentYear, month };
    });

    const filledResult = fullMonths.map(({ year, month }) => {
      const data = result.find(
        (item) => item.year === year && item.month === month,
      );
      return {
        dm_cid_count: data ? data.dm_cid_count : 0,
        ht_cid_count: data ? data.ht_cid_count : 0,
        copd_cid_count: data ? data.copd_cid_count : 0,
        ca_cid_count: data ? data.ca_cid_count : 0,
        psy_cid_count: data ? data.psy_cid_count : 0,
        hd_cvd_cid_count: data ? data.hd_cvd_cid_count : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "ทั้งหมด",
        data: filledResult.map((item) => {
          return (
            item.dm_cid_count +
            item.ht_cid_count +
            item.copd_cid_count +
            item.ca_cid_count +
            item.psy_cid_count +
            item.hd_cvd_cid_count
          );
        }),
      },
      {
        diseaseName: "โรคเบาหวาน",
        data: filledResult.map((item) => item.dm_cid_count),
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        data: filledResult.map((item) => item.ht_cid_count),
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        data: filledResult.map((item) => item.copd_cid_count),
      },
      {
        diseaseName: "โรคมะเร็ง",
        data: filledResult.map((item) => item.ca_cid_count),
      },
      {
        diseaseName: "สุขภาพจิต",
        data: filledResult.map((item) => item.psy_cid_count),
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        data: filledResult.map((item) => item.hd_cvd_cid_count),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process disease patient data:", error);
  }
}

async function diseasePatientServiceV2(body) {
  try {
    const isAreaEmpty = body.area === "";
    const isProvinceEmpty = body.province === "";
    const isDistrictEmpty = body.district === "";
    const isHospitalCodeEmpty = body.hcode === "";

    const shouldCallTempCollection =
      isAreaEmpty && isProvinceEmpty && isDistrictEmpty && isHospitalCodeEmpty;

    if (shouldCallTempCollection) return getDataFromTempTable();

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1; // Months are 0-indexed in JavaScript
    const currentYear = currentDate.getFullYear();

    const months = [];
    for (let i = 0; i < 12; i++) {
      let month = currentMonth - i;
      let year = currentYear;
      if (month <= 0) {
        month += 12;
        year -= 1;
      }
      months.unshift({ year, month }); // Add to the beginning to keep chronological order
    }

    const [
      dmPatient,
      htPatient,
      copdPatient,
      caPatient,
      psyPatient,
      hdCvdPatient,
    ] = await Promise.all([
      dmPatientCount({ ...body, months }),
      htPatientCount({ ...body, months }),
      copdPatientCount({ ...body, months }),
      caPatientCount({ ...body, months }),
      psyPatientCount({ ...body, months }),
      hdCvdPatientCount({ ...body, months }),
    ]);

    const filledResult = months.map(({ year, month }) => {
      const dmData =
        dmPatient.find((item) => item.year === year && item.month === month) ||
        {};
      const htData =
        htPatient.find((item) => item.year === year && item.month === month) ||
        {};
      const copdData =
        copdPatient.find(
          (item) => item.year === year && item.month === month,
        ) || {};
      const caData =
        caPatient.find((item) => item.year === year && item.month === month) ||
        {};
      const psyData =
        psyPatient.find((item) => item.year === year && item.month === month) ||
        {};
      const hdCvdData =
        hdCvdPatient.find(
          (item) => item.year === year && item.month === month,
        ) || {};

      return {
        year,
        month,
        dm_cid_count: dmData.dm_cid_count || 0,
        ht_cid_count: htData.ht_cid_count || 0,
        copd_cid_count: copdData.copd_cid_count || 0,
        ca_cid_count: caData.ca_cid_count || 0,
        psy_cid_count: psyData.psy_cid_count || 0,
        hd_cvd_cid_count: hdCvdData.hd_cvd_cid_count || 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "ทั้งหมด",
        data: filledResult.map((item) => {
          return (
            item.dm_cid_count +
            item.ht_cid_count +
            item.copd_cid_count +
            item.ca_cid_count +
            item.psy_cid_count +
            item.hd_cvd_cid_count
          );
        }),
      },
      {
        diseaseName: "โรคเบาหวาน",
        data: filledResult.map((item) => item.dm_cid_count),
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        data: filledResult.map((item) => item.ht_cid_count),
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        data: filledResult.map((item) => item.copd_cid_count),
      },
      {
        diseaseName: "โรคมะเร็ง",
        data: filledResult.map((item) => item.ca_cid_count),
      },
      {
        diseaseName: "สุขภาพจิต",
        data: filledResult.map((item) => item.psy_cid_count),
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        data: filledResult.map((item) => item.hd_cvd_cid_count),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process disease patient data:", error);
  }
}

module.exports = { diseasePatientService, diseasePatientServiceV2 };
