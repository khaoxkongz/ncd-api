const {
  dmPatientRepository,
  hgPatientCount,
  dmCkdPatientCount,
  dmAcsPatientCount,
  dmCvaPatientCount,
  dmPatientCount,
  getDataFromTempTable,
} = require("./dm-pt.repository");

async function dmPatientService(body) {
  try {
    const result = await dmPatientRepository(body);

    const fullMonths = Array.from({ length: 12 }, (_, i) => {
      const currentYear = i < 9 ? body.year : body.year + 1;
      const month = (i + 4) % 12 || 12;
      return { year: currentYear, month };
    });

    const filledResult = fullMonths.map(({ year, month }) => {
      const data = result.find((item) => item.year === year && item.month === month);
      return {
        hg_cid_count: data ? data.hg_cid_count : 0,
        dm_ckd_cid_count: data ? data.dm_ckd_cid_count : 0,
        dm_acs_cid_count: data ? data.dm_acs_cid_count : 0,
        dm_cva_cid_count: data ? data.dm_cva_cid_count : 0,
        dm_cid_count: data ? data.dm_cid_count : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
        data: filledResult.map((item) => item.hg_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
        data: filledResult.map((item) => item.dm_ckd_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
        data: filledResult.map((item) => item.dm_acs_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
        data: filledResult.map((item) => item.dm_cva_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.dm_cid_count -
            (item.hg_cid_count + item.dm_ckd_cid_count + item.dm_acs_cid_count + item.dm_cva_cid_count);
          return difference < 0 ? 0 : difference;
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process dm patient data:", error);
  }
}

async function dmPatientServiceV2(body) {
  try {
    const isAreaEmpty = body.area === "";
    const isProvinceEmpty = body.province === "";
    const isDistrictEmpty = body.district === "";
    const isHospitalCodeEmpty = body.hcode === "";

    const shouldCallTempCollection = isAreaEmpty && isProvinceEmpty && isDistrictEmpty && isHospitalCodeEmpty;

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

    const [hgPatient, dmCkdPatient, dmAcsPatient, dmCvaPatient, dmPatient] = await Promise.all([
      hgPatientCount({ ...body, months }),
      dmCkdPatientCount({ ...body, months }),
      dmAcsPatientCount({ ...body, months }),
      dmCvaPatientCount({ ...body, months }),
      dmPatientCount({ ...body, months }),
    ]);

    const filledResult = months.map(({ year, month }) => {
      const hgData = hgPatient.find((item) => item.year === year && item.month === month) || {};
      const dmCkdData = dmCkdPatient.find((item) => item.year === year && item.month === month) || {};
      const dmAcsData = dmAcsPatient.find((item) => item.year === year && item.month === month) || {};
      const dmCvaData = dmCvaPatient.find((item) => item.year === year && item.month === month) || {};
      const dmData = dmPatient.find((item) => item.year === year && item.month === month) || {};

      return {
        year,
        month,
        hg_cid_count: hgData.hg_cid_count || 0,
        dm_ckd_cid_count: dmCkdData.dm_ckd_cid_count || 0,
        dm_acs_cid_count: dmAcsData.dm_acs_cid_count || 0,
        dm_cva_cid_count: dmCvaData.dm_cva_cid_count || 0,
        dm_cid_count: dmData.dm_cid_count || 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
        data: filledResult.map((item) => item.hg_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
        data: filledResult.map((item) => item.dm_ckd_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
        data: filledResult.map((item) => item.dm_acs_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
        data: filledResult.map((item) => item.dm_cva_cid_count),
      },
      {
        diseaseName: "เบาหวานชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.dm_cid_count -
            (item.hg_cid_count + item.dm_ckd_cid_count + item.dm_acs_cid_count + item.dm_cva_cid_count);
          return difference < 0 ? 0 : difference;
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process dm patient data:", error);
  }
}

module.exports = { dmPatientService, dmPatientServiceV2 };
