const {
  caPatientRepository,
  caPatientCount,
  lungCaPatientCount,
  breastCaPatientCount,
  cervicalCaPatientCount,
  liverCaPatientCount,
  colorectalCaPatientCount,
  getDataFromTempTable,
} = require("./ca-pt.repository");

async function caPatientService(body) {
  try {
    const result = await caPatientRepository(body);

    const fullMonths = Array.from({ length: 12 }, (_, i) => {
      const currentYear = i < 9 ? body.year : body.year + 1;
      const month = (i + 4) % 12 || 12;
      return { year: currentYear, month };
    });

    const filledResult = fullMonths.map(({ year, month }) => {
      const data = result.find((item) => item.year === year && item.month === month);
      return {
        ca_cid_count: data ? data.ca_cid_count : 0,
        lung_ca_cid_count: data ? data.lung_ca_cid_count : 0,
        breast_ca_cid_count: data ? data.breast_ca_cid_count : 0,
        cervical_ca_cid_count: data ? data.cervical_ca_cid_count : 0,
        liver_ca_cid_count: data ? data.liver_ca_cid_count : 0,
        colorectal_ca_cid_count: data ? data.colorectal_ca_cid_count : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "โรคมะเร็งปอด",
        data: filledResult.map((item) => item.lung_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งเต้านม",
        data: filledResult.map((item) => item.breast_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งปากมดลูก",
        data: filledResult.map((item) => item.cervical_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งตับ",
        data: filledResult.map((item) => item.liver_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งลำไส้ใหญ่",
        data: filledResult.map((item) => item.colorectal_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.ca_cid_count -
            (item.lung_ca_cid_count +
              item.breast_ca_cid_count +
              item.cervical_ca_cid_count +
              item.liver_ca_cid_count +
              item.colorectal_ca_cid_count);
          return difference < 0 ? 0 : difference;
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process dm patient data:", error);
  }
}

async function caPatientServiceV2(body) {
  const isAreaEmpty = body.area === "";
  const isProvinceEmpty = body.province === "";
  const isDistrictEmpty = body.district === "";
  const isHospitalCodeEmpty = body.hcode === "";

  const shouldCallTempCollection = isAreaEmpty && isProvinceEmpty && isDistrictEmpty && isHospitalCodeEmpty;

  try {
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

    const [caPatient, lungCaPatient, breastCaPatient, cervicalCaPatient, liverCaPatient, colorectalCaPatient] =
      await Promise.all([
        caPatientCount({ ...body, months }),
        lungCaPatientCount({ ...body, months }),
        breastCaPatientCount({ ...body, months }),
        cervicalCaPatientCount({ ...body, months }),
        liverCaPatientCount({ ...body, months }),
        colorectalCaPatientCount({ ...body, months }),
      ]);

    const filledResult = months.map(({ year, month }) => {
      const caData = caPatient.find((item) => item.year === year && item.month === month) || {};
      const lungData = lungCaPatient.find((item) => item.year === year && item.month === month) || {};
      const breastData = breastCaPatient.find((item) => item.year === year && item.month === month) || {};
      const cervicalData = cervicalCaPatient.find((item) => item.year === year && item.month === month) || {};
      const liverData = liverCaPatient.find((item) => item.year === year && item.month === month) || {};
      const colorectalData = colorectalCaPatient.find((item) => item.year === year && item.month === month) || {};

      return {
        year,
        month,
        ca_cid_count: caData.ca_cid_count || 0,
        lung_ca_cid_count: lungData.lung_ca_cid_count || 0,
        breast_ca_cid_count: breastData.breast_ca_cid_count || 0,
        cervical_ca_cid_count: cervicalData.cervical_ca_cid_count || 0,
        liver_ca_cid_count: liverData.liver_ca_cid_count || 0,
        colorectal_ca_cid_count: colorectalData.colorectal_ca_cid_count || 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "โรคมะเร็งปอด",
        data: filledResult.map((item) => item.lung_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งเต้านม",
        data: filledResult.map((item) => item.breast_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งปากมดลูก",
        data: filledResult.map((item) => item.cervical_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งตับ",
        data: filledResult.map((item) => item.liver_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งลำไส้ใหญ่",
        data: filledResult.map((item) => item.colorectal_ca_cid_count),
      },
      {
        diseaseName: "โรคมะเร็งชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.ca_cid_count -
            (item.lung_ca_cid_count +
              item.breast_ca_cid_count +
              item.cervical_ca_cid_count +
              item.liver_ca_cid_count +
              item.colorectal_ca_cid_count);
          return difference < 0 ? 0 : difference;
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process dm patient data:", error);
  }
}

module.exports = { caPatientService, caPatientServiceV2 };
