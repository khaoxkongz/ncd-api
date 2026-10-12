const {
  diseaseExpenseRepository,
  getDataFromTempTable,
} = require("./disease-ex.repository");

async function diseaseExpenseService(body) {
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

    const result = await diseaseExpenseRepository({ ...body, months });

    const filledResult = months.map(({ year, month }) => {
      const data = result.find(
        (item) => item.year === year && item.month === month,
      );
      return {
        dm_expense: data ? data.dm_expense : 0,
        ht_expense: data ? data.ht_expense : 0,
        copd_expense: data ? data.copd_expense : 0,
        ca_expense: data ? data.ca_expense : 0,
        psy_expense: data ? data.psy_expense : 0,
        hd_cvd_expense: data ? data.hd_cvd_expense : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "ทั้งหมด",
        data: filledResult.map((item) => {
          const summary =
            item.dm_expense +
            item.ht_expense +
            item.copd_expense +
            item.ca_expense +
            item.psy_expense +
            item.hd_cvd_expense;
          return Number.parseFloat(summary.toFixed(2), 10);
        }),
      },
      {
        diseaseName: "โรคเบาหวาน",
        data: filledResult.map((item) => item.dm_expense),
      },
      {
        diseaseName: "โรคความดันโลหิตสูง",
        data: filledResult.map((item) => item.ht_expense),
      },
      {
        diseaseName: "โรคปอดอุดกั้นเรื้อรัง",
        data: filledResult.map((item) => item.copd_expense),
      },
      {
        diseaseName: "โรคมะเร็ง",
        data: filledResult.map((item) => item.ca_expense),
      },
      {
        diseaseName: "สุขภาพจิต",
        data: filledResult.map((item) => item.psy_expense),
      },
      {
        diseaseName: "โรคหัวใจและหลอดเลือด",
        data: filledResult.map((item) => item.hd_cvd_expense),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process disease expense data:", error);
  }
}

module.exports = { diseaseExpenseService };
