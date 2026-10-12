const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function dmExpenseRepository({ area, province, district, hcode, months }) {
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
        hg_expense: { $sum: "$hg_expense" },
        dm_ckd_expense: { $sum: "$dm_ckd_expense" },
        dm_acs_expense: { $sum: "$dm_acs_expense" },
        dm_cva_expense: { $sum: "$dm_cva_expense" },
        dm_expense: { $sum: "$dm_expense" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        hg_expense: { $round: ["$hg_expense", 2] },
        dm_ckd_expense: { $round: ["$dm_ckd_expense", 2] },
        dm_acs_expense: { $round: ["$dm_acs_expense", 2] },
        dm_cva_expense: { $round: ["$dm_cva_expense", 2] },
        dm_expense: { $round: ["$dm_expense", 2] },
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
        dm_expense: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].dm_expense;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = { dmExpenseRepository, getDataFromTempTable };
