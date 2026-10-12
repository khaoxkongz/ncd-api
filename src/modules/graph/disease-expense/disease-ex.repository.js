const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function diseaseExpenseRepository({ area, province, district, hcode, months }) {
  const collection = db.collection(COLLECTION_NAME);
  try {
    const matchStage = {
      $match: {
        $and: [
          {
            ...(area && { area }),
            ...(province && { province }),
            ...(district && { district }),
            ...(hcode && { hcode }),
          },
          {
            $or: months.map(({ year, month }) => ({
              year,
              month,
            })),
          },
        ],
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
        },
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
        year: "$_id.year",
        month: "$_id.month",
        dm_expense: { $round: ["$dm_expense", 2] },
        ht_expense: { $round: ["$ht_expense", 2] },
        copd_expense: { $round: ["$copd_expense", 2] },
        ca_expense: { $round: ["$ca_expense", 2] },
        psy_expense: { $round: ["$psy_expense", 2] },
        hd_cvd_expense: { $round: ["$hd_cvd_expense", 2] },
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [matchStage, groupStage, projectStage, sortStage];

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
        disease_expense: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].disease_expense;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = { diseaseExpenseRepository, getDataFromTempTable };
