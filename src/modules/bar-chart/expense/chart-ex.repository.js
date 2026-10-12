const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function chartExpenseRepository({ startDate, endDate, area, province, district, hcode }) {
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
        dm_expense: { $sum: "$dm_expense" },
        ht_cid_count: { $sum: "$ht_cid_count" },
        ht_expense: { $sum: "$ht_expense" },
        copd_cid_count: { $sum: "$copd_cid_count" },
        copd_expense: { $sum: "$copd_expense" },
        ca_cid_count: { $sum: "$ca_cid_count" },
        ca_expense: { $sum: "$ca_expense" },
        psy_cid_count: { $sum: "$psy_cid_count" },
        psy_expense: { $sum: "$psy_expense" },
        hd_cvd_cid_count: { $sum: "$hd_cvd_cid_count" },
        hd_cvd_expense: { $sum: "$hd_cvd_expense" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        dm_cid_count: 1,
        dm_expense: 1,
        ht_cid_count: 1,
        ht_expense: 1,
        copd_cid_count: 1,
        copd_expense: 1,
        ca_cid_count: 1,
        ca_expense: 1,
        psy_cid_count: 1,
        psy_expense: 1,
        hd_cvd_cid_count: 1,
        hd_cvd_expense: 1,
      },
    };

    const agg = [matchStage, groupStage, projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function chartExpenseRepositoryV2({ startDate, endDate, area, province, district, hcode }) {
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
        dm_expense: { $sum: "$dm_expense" },
        ht_expense: { $sum: "$ht_expense" },
        copd_expense: { $sum: "$copd_expense" },
        ca_expense: { $sum: "$ca_expense" },
        psy_expense: { $sum: "$psy_expense" },
        hd_cvd_expense: { $sum: "$hd_cvd_expense" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        dm_expense: 1,
        ht_expense: 1,
        copd_expense: 1,
        ca_expense: 1,
        psy_expense: 1,
        hd_cvd_expense: 1,
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
        chart_expense: 1,
      },
    };

    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].chart_expense;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}
module.exports = { chartExpenseRepository, chartExpenseRepositoryV2, getDataFromTempTable };
