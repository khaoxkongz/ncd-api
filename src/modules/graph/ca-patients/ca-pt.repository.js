const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function caPatientRepository({ area, province, district, hcode, months }) {
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
        ca_cid_count: { $sum: "$ca_cid_count" },
        lung_ca_cid_count: { $sum: "$lung_ca_cid_count" },
        breast_ca_cid_count: { $sum: "$breast_ca_cid_count" },
        cervical_ca_cid_count: { $sum: "$cervical_ca_cid_count" },
        liver_ca_cid_count: { $sum: "$liver_ca_cid_count" },
        colorectal_ca_cid_count: { $sum: "$colorectal_ca_cid_count" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        ca_cid_count: 1,
        lung_ca_cid_count: 1,
        breast_ca_cid_count: 1,
        cervical_ca_cid_count: 1,
        liver_ca_cid_count: 1,
        colorectal_ca_cid_count: 1,
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

async function caPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          ca_cid_count: "$ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function lungCaPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        lung_ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          lung_ca_cid_count: "$lung_ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        lung_ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        lung_ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$lung_ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function breastCaPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        breast_ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          breast_ca_cid_count: "$breast_ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        breast_ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        breast_ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$breast_ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function cervicalCaPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        cervical_ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          cervical_ca_cid_count: "$cervical_ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        cervical_ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        cervical_ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$cervical_ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function liverCaPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        liver_ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          liver_ca_cid_count: "$liver_ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        liver_ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        liver_ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$liver_ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
    const result = await collection.aggregate(agg).toArray();
    return result;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function colorectalCaPatientCount({ area, province, district, hcode, months }) {
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

    const projectStage1 = {
      $project: {
        _id: 0,
        year: 1,
        month: 1,
        colorectal_ca_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          colorectal_ca_cid_count: "$colorectal_ca_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        colorectal_ca_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        colorectal_ca_cid_count: 1,
      },
    };

    const sortStage = {
      $sort: {
        year: 1,
        month: 1,
      },
    };

    const agg = [
      matchStage,
      projectStage1,
      { $unwind: "$colorectal_ca_cid_count" },
      groupStage,
      countStage,
      projectStage2,
      sortStage,
    ];
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
        ca_patient: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].ca_patient;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = {
  caPatientRepository,
  caPatientCount,
  lungCaPatientCount,
  breastCaPatientCount,
  cervicalCaPatientCount,
  liverCaPatientCount,
  colorectalCaPatientCount,
  getDataFromTempTable,
};
