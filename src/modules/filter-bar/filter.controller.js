const {
  filterDropDownService,
  filterFiscalYearDropDown,
  dateUpdate,
  getHealthOfficeDetail,
} = require("./filter.service");

const controllerFilterDropdown = {
  filterDropDown: async (req, res) => {
    try {
      const { type, area, province, district, hospital_code } = req.body;
      // console.log("controll", type)
      const result = await filterDropDownService(
        type,
        area,
        province,
        district,
        hospital_code,
      );
      if (!result[0]) {
        throw {
          message: result[1],
        };
      }
      const response = {
        status: true,
        message: "success",
        type: result[2],
        data: result[1],
      };
      return res.status(200).json(response);
    } catch (error) {
      console.error(error);
      // if (error instanceof Error) return res.status(500).json({
      //     error: error.message
      // });
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
  filterFiscalYearDropDown: async (req, res) => {
    try {
      const result = await filterFiscalYearDropDown();
      if (!result[0]) {
        throw {
          message: result[1],
        };
      }
      const response = {
        status: true,
        message: "success",
        data: result[1],
      };
      return res.status(200).json(response);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
  dateUpdate: async (req, res) => {
    try {
      const result = await dateUpdate();
      if (!result[0]) {
        throw {
          message: result[1],
        };
      }
      const response = {
        status: true,
        message: "success",
        date: result[2],
        date_format: result[1],
      };
      return res.status(200).json(response);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
  getHealthOfficeDetail: async (req, res) => {
    try {
      let body = req.body;

      const resData = await getHealthOfficeDetail(body);
      if (!resData[0]) {
        throw {
          message: resData[1],
        };
      }

      const response = {
        status: true,
        message: "success",
        data: resData[1],
      };
      return res.status(200).json(response);
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = {
  default: controllerFilterDropdown,
};
