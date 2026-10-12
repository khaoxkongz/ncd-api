const { caExpenseRepository, getDataFromTempTable } = require("./ca-ex.repository");

// 1. หาข้อมูล NCD_SUMMARY โดย
// - ถ้า Area, Province, District, และ Hcode หนึ่งในนี้มี String เปล่า
// - ให้ Lookup ข้อมูล จาก Temp collection ก่อน
// - เนื่องจากมีความเร็วมากกว่า
// 2. หาข้อมูล 12 เดือนล่าสุดจากวันปัจจุบัน
async function caExpenseService(body) {
  const isAreaEmpty = body.area === "";
  const isProvinceEmpty = body.province === "";
  const isDistrictEmpty = body.district === "";
  const isHospitalCodeEmpty = body.hcode === "";

  const shouldCallTempCollection = isAreaEmpty && isProvinceEmpty && isDistrictEmpty && isHospitalCodeEmpty;

  try {
    if (shouldCallTempCollection) return getDataFromTempTable();

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    const months = [];
    for (let i = 0; i < 12; i++) {
      let month = currentMonth - i;
      let year = currentYear;
      if (month <= 0) {
        month += 12;
        year -= 1;
      }
      months.unshift({ year, month });
    }

    const result = await caExpenseRepository({ ...body, months });

    const filledResult = months.map(({ year, month }) => {
      const data = result.find((item) => item.year === year && item.month === month);
      return {
        ca_expense: data ? data.ca_expense : 0,
        lung_ca_expense: data ? data.lung_ca_expense : 0,
        breast_ca_expense: data ? data.breast_ca_expense : 0,
        cervical_ca_expense: data ? data.cervical_ca_expense : 0,
        liver_ca_expense: data ? data.liver_ca_expense : 0,
        colorectal_ca_expense: data ? data.colorectal_ca_expense : 0,
      };
    });

    const finalResult = [
      {
        diseaseName: "โรคมะเร็งปอด",
        data: filledResult.map((item) => item.lung_ca_expense),
      },
      {
        diseaseName: "โรคมะเร็งเต้านม",
        data: filledResult.map((item) => item.breast_ca_expense),
      },
      {
        diseaseName: "โรคมะเร็งปากมดลูก",
        data: filledResult.map((item) => item.cervical_ca_expense),
      },
      {
        diseaseName: "โรคมะเร็งตับ",
        data: filledResult.map((item) => item.liver_ca_expense),
      },
      {
        diseaseName: "โรคมะเร็งลำไส้ใหญ่",
        data: filledResult.map((item) => item.colorectal_ca_expense),
      },
      {
        diseaseName: "โรคมะเร็งชนิดอื่น ๆ",
        data: filledResult.map((item) => {
          const difference =
            item.ca_expense -
            (item.lung_ca_expense +
              item.breast_ca_expense +
              item.cervical_ca_expense +
              item.liver_ca_expense +
              item.colorectal_ca_expense);
          return difference < 0 ? 0 : Number.parseFloat(difference.toFixed(2), 10);
        }),
      },
    ];

    return finalResult;
  } catch (error) {
    console.error("Failed to process ca expense data:", error);
    return [];
  }
}

module.exports = { caExpenseService };
