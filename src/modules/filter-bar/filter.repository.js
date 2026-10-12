const { db } = require("../../lib/mongo");

const collectionHospitalMoph = db.collection("Hospital_Moph");
const collectionNcdSummary = db.collection("NCD_SUMMARY");

const repository = {
  getHospitalName: async (filter) => {
    try {
      const resDatafindHname = await collectionHospitalMoph
        .aggregate([
          {
            $match: filter,
          },
          {
            $sort: {
              hcode: 1,
            },
          },
          {
            $project: {
              hcode: 1,
              hname: 1,
            },
          },
        ])
        .toArray();

      return resDatafindHname;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getDistrict: async (filter) => {
    try {
      const resDatafindDistrict = await collectionHospitalMoph.distinct(
        "hcode",
        filter,
      );
      return resDatafindDistrict;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getDistrictInProvince: async (filter) => {
    try {
      const resDatafindProvince = await collectionHospitalMoph.distinct(
        "district",
        filter,
      );
      return resDatafindProvince;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getProvinceInArea: async (filter) => {
    try {
      const resDatafindProvinceInArea = await collectionHospitalMoph.distinct(
        "province",
        filter,
      );
      return resDatafindProvinceInArea;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getFiscalYearSummaryTable: async () => {
    try {
      const resDatafindFiscalYear =
        await collectionNcdSummary.distinct("fiscal_year");
      return resDatafindFiscalYear;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getDateUpdateSummaryTable: async () => {
    try {
      let resDataDate = await collectionNcdSummary.findOne(
        {},
        {
          sort: {
            updated_at: -1,
          },
          projection: {
            updated_at: 1,
            _id: 0,
          },
        },
      );

      return resDataDate;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
  getHealthOfficeDetail: async (queryString) => {
    try {
      const resData = await collectionHospitalMoph.findOne(queryString, {
        projection: {
          area: 1,
          hname: 1,
          hcode: 1,
          province: 1,
          district: 1,
          _id: 0,
        },
      });
      return resData;
    } catch (error) {
      console.error(error);
      throw error;
    }
  },
};
module.exports = {
  default: repository,
};
