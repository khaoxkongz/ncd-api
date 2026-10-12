const {
  dmExpenseRepository,
  getDataFromTempTable,
} = require("./dm-ex.repository");

async function dmExpenseService(body) {
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

    const result = await dmExpenseRepository({ ...body, months });

    const filledResult = months.map(({ year, month }) => {
      const data = result.find(
        (item) => item.year === year && item.month === month,
      );
      return {
        hg_expense: data ? data.hg_expense : 0,
        dm_ckd_expense: data ? data.dm_ckd_expense : 0,
        dm_acs_expense: data ? data.dm_acs_expense : 0,
        dm_cva_expense: data ? data.dm_cva_expense : 0,
        dm_expense: data ? data.dm_expense : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ที่มีภาวะน้ำตาลในเลือดสูง",
        data: filledResult.map((item) => item.hg_expense),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคไตเรื้อรัง",
        data: filledResult.map((item) => item.dm_ckd_expense),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหัวใจขาดเลือด",
        data: filledResult.map((item) => item.dm_acs_expense),
      },
      {
        diseaseName: "เบาหวานชนิดต่าง ๆ ร่วมกับโรคหลอดเลือดสมอง",
        data: filledResult.map((item) => item.dm_cva_expense),
      },
      {
        diseaseName: "เบาหวานชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.dm_expense -
            (item.hg_expense +
              item.dm_ckd_expense +
              item.dm_acs_expense +
              item.dm_cva_expense);
          return difference < 0
            ? 0
            : Number.parseFloat(difference.toFixed(2), 10);
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process dm expense data:", error);
  }
}

module.exports = { dmExpenseService };
