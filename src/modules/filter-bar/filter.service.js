const { default: repository } = require("./filter.repository");

async function filterDropDownService(type, area, province, district, hospital_code) {
  try {
    // console.log("type", type)
    // console.log("hospital_code", hospital_code)

    const validTypes = ["hospital_code", "district", "province", "area"];
    if (!validTypes.includes(type)) {
      throw {
        message: "Invalid type specified",
      };
    }

    const typeDescriptions = {
      hospital_code: "หน่วยบริการ",
      district: "อำเภอ",
      province: "จังหวัด",
      // area: 'เขต',
    };

    const queryString = {};

    if (province) {
      queryString.province = province;
    }
    if (area) {
      queryString.area = area;
    }

    if (hospital_code) {
      queryString.hcode = hospital_code;
    }

    if (district) {
      queryString.district = district;
    }

    let result = [];

    if (type == "hospital_code") {
      const find_hospital = await repository.getHospitalName(queryString);
      const resData = find_hospital.map((el) => {
        const jsonData = {
          hcode: el.hcode,
          hname: el.hname,
          full_text: `${el.hcode} : ${el.hname}`,
        };
        return jsonData;
      });

      result = resData;
    } else if (type == "district") {
      // หาอำเภอในจังหวัด
      const find_province = await repository.getDistrictInProvince(queryString);

      const resData = find_province.filter((item) => item !== null && item !== "");
      result = resData;
    }
    // else if (type == 'district') { //เอาอำเภอมาหาโรงพยาบาลในอำเภอนั้นๆ

    //     let find_district = await repository.getHospitalName(queryString)

    //     // let resData = find_district.filter((item) => item !== null);
    //     let resData = find_district.map((el) => {
    //         const jsonData = {
    //             hcode: el.hcode,
    //             hname: el.hname,
    //             full_text: `${el.hcode} : ${el.hname}`,
    //         };
    //         return jsonData;
    //     });
    //     result = resData;

    // }
    else if (type == "province") {
      // หาจังหวัดในเขต
      const find_province = await repository.getProvinceInArea(queryString);
      const resData = find_province.filter((item) => item !== null);
      result = resData;
    }

    // let resultRes = {
    // queryString,
    // data: result,
    // type: typeDescriptions[type]
    // }

    return [true, result, typeDescriptions[type]];
  } catch (error) {
    console.log(error);
    return [false, error.message];
  }
}

async function filterFiscalYearDropDown() {
  try {
    const find_fiscal_year = await repository.getFiscalYearSummaryTable();

    return [true, find_fiscal_year];
  } catch (error) {
    console.log(error);
    return [false, error.message];
  }
}

const dateUpdate = async () => {
  try {
    let find_date_update = await repository.getDateUpdateSummaryTable();
    let formatDateRes = funcFormatDate(find_date_update.updated_at);

    return [true, formatDateRes, find_date_update.updated_at];
  } catch (error) {
    console.log(error);
    return [false, error.message];
  }
};

const getHealthOfficeDetail = async (body) => {
  try {
    const { hospital_code, province } = body;

    const queryString = {};
    if (hospital_code) {
      queryString["hcode"] = hospital_code;
    }
    if (province) {
      queryString["province"] = province;
    }

    let resData = await repository.getHealthOfficeDetail(queryString);

    if (resData !== null) {
      return [true, resData];
    } else if (resData === null) {
      return [false, "ไม่พบข้อมูล"];
    } else {
      return [false, resData];
    }
  } catch (error) {
    console.log(error);
    return [false, error.message];
  }
};

const funcFormatDate = (mongoDateStr) => {
  const date = new Date(mongoDateStr);

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const formattedTime = `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;

  return `${day}/${month}/${year} ${formattedTime}`;
};

module.exports = {
  filterDropDownService,
  filterFiscalYearDropDown,
  dateUpdate,
  getHealthOfficeDetail,
};
