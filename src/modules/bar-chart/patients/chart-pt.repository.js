const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");
const { COLLECTION_NAME_TEMP_CHART_PT } = require("../../../models/temp-table-chart-pt");

async function chartPatientRepository({ startDate, endDate, area, province, district, hcode }) {
  const collection = db.collection(COLLECTION_NAME);
  const dateStart = new Date(`${startDate}`);
  const dateEnd = new Date(`${endDate}`);
  try {
    const matchStage = {
      $match: {
        date: { $gte: dateStart, $lte: dateEnd },
        ...(area && { area }),
        ...(province && { province }),
        ...(district && { district }),
        ...(hcode && { hcode }),
      },
    };

    const groupStage = {
      $group: {
        _id: null,
        dm_cid_count: { $sum: "$dm_cid_count" },
        dm_uid_count: { $sum: "$dm_uid_count" },
        ht_cid_count: { $sum: "$ht_cid_count" },
        ht_uid_count: { $sum: "$ht_uid_count" },
        copd_cid_count: { $sum: "$copd_cid_count" },
        copd_uid_count: { $sum: "$copd_uid_count" },
        ca_cid_count: { $sum: "$ca_cid_count" },
        ca_uid_count: { $sum: "$ca_uid_count" },
        psy_cid_count: { $sum: "$psy_cid_count" },
        psy_uid_count: { $sum: "$psy_uid_count" },
        hd_cvd_cid_count: { $sum: "$hd_cvd_cid_count" },
        hd_cvd_uid_count: { $sum: "$hd_cvd_uid_count" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        dm_cid_count: 1,
        dm_uid_count: 1,
        ht_cid_count: 1,
        ht_uid_count: 1,
        copd_cid_count: 1,
        copd_uid_count: 1,
        ca_cid_count: 1,
        ca_uid_count: 1,
        psy_cid_count: 1,
        psy_uid_count: 1,
        hd_cvd_cid_count: 1,
        hd_cvd_uid_count: 1,
      },
    };

    const agg = [matchStage, groupStage, projectStage];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function chartPatientRepositoryV2({ startDate, endDate, area, province, district, hcode }) {
  const collection = db.collection(COLLECTION_NAME);
  const dateStart = new Date(`${startDate}`);
  const dateEnd = new Date(`${endDate}`);
  try {
    const matchStage = {
      $match: {
        date: { $gte: dateStart, $lte: dateEnd },
        ...(area && { area }),
        ...(province && { province }),
        ...(district && { district }),
        ...(hcode && { hcode }),
      },
    };

    const groupStage = {
      $group: {
        _id: null,
        dm_uid_count: { $sum: "$dm_uid_count" },
        ht_uid_count: { $sum: "$ht_uid_count" },
        copd_uid_count: { $sum: "$copd_uid_count" },
        ca_uid_count: { $sum: "$ca_uid_count" },
        psy_uid_count: { $sum: "$psy_uid_count" },
        hd_cvd_uid_count: { $sum: "$hd_cvd_uid_count" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        dm_uid_count: 1,
        ht_uid_count: 1,
        copd_uid_count: 1,
        ca_uid_count: 1,
        psy_uid_count: 1,
        hd_cvd_uid_count: 1,
      },
    };

    const agg = [matchStage, groupStage, projectStage];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function getDataFromTempTable() {
  const collection = db.collection(COLLECTION_NAME_TEMP);
  try {
    const projectStage = {
      $project: {
        chart_patient: 1,
      },
    };

    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].chart_patient;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function getDataFromTempChartPTTable() {
  const collection = db.collection(COLLECTION_NAME_TEMP_CHART_PT);
  try {
    const projectStage = {
      $project: {
        chart_patient: 1,
      },
    };

    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].chart_patient;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = {
  chartPatientRepository,
  chartPatientRepositoryV2,
  getDataFromTempTable,
  getDataFromTempChartPTTable,
};
