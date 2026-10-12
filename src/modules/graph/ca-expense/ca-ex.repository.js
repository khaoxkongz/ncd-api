const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function caExpenseRepository({
  area,
  province,
  district,
  hcode,
  months,
}) {
  const collection = db.collection(COLLECTION_NAME);

  const match = {
    $and: [
      { ...(area && { area }) },
      { ...(province && { province }) },
      { ...(district && { district }) },
      { ...(hcode && { hcode }) },
      { $or: months.map(({ year, month }) => ({ year, month })) },
    ].filter(Boolean),
  };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { year: "$year", month: "$month" },
        ca_expense: { $sum: "$ca_expense" },
        lung_ca_expense: { $sum: "$lung_ca_expense" },
        breast_ca_expense: { $sum: "$breast_ca_expense" },
        cervical_ca_expense: { $sum: "$cervical_ca_expense" },
        liver_ca_expense: { $sum: "$liver_ca_expense" },
        colorectal_ca_expense: { $sum: "$colorectal_ca_expense" },
      },
    },
    {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        ca_expense: 1,
        lung_ca_expense: 1,
        breast_ca_expense: 1,
        cervical_ca_expense: 1,
        liver_ca_expense: 1,
        colorectal_ca_expense: 1,
      },
    },
    { $sort: { year: 1, month: 1 } },
  ];

  try {
    const result = await collection.aggregate(pipeline).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
    return [];
  }
}

async function getDataFromTempTable() {
  const collection = db.collection(COLLECTION_NAME_TEMP);
  try {
    const projectStage = {
      $project: {
        ca_expense: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].ca_expense;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = { caExpenseRepository, getDataFromTempTable };
