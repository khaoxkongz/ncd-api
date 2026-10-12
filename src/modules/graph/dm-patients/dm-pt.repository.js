const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function dmPatientRepository({
  area,
  province,
  district,
  hcode,
  months,
}) {
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
        hg_cid_count: { $sum: "$hg_cid_count" },
        dm_ckd_cid_count: { $sum: "$dm_ckd_cid_count" },
        dm_acs_cid_count: { $sum: "$dm_acs_cid_count" },
        dm_cva_cid_count: { $sum: "$dm_cva_cid_count" },
        dm_cid_count: { $sum: "$dm_cid_count" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        hg_cid_count: 1,
        dm_ckd_cid_count: 1,
        dm_acs_cid_count: 1,
        dm_cva_cid_count: 1,
        dm_cid_count: 1,
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

async function hgPatientCount({ area, province, district, hcode, months }) {
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
        hg_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          hg_cid_count: "$hg_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        hg_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        hg_cid_count: 1,
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
      { $unwind: "$hg_cid_count" },
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

async function dmCkdPatientCount({ area, province, district, hcode, months }) {
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
        dm_ckd_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          dm_ckd_cid_count: "$dm_ckd_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        dm_ckd_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        dm_ckd_cid_count: 1,
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
      { $unwind: "$dm_ckd_cid_count" },
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

async function dmAcsPatientCount({ area, province, district, hcode, months }) {
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
        dm_acs_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          dm_acs_cid_count: "$dm_acs_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        dm_acs_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        dm_acs_cid_count: 1,
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
      { $unwind: "$dm_acs_cid_count" },
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

async function dmCvaPatientCount({ area, province, district, hcode, months }) {
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
        dm_cva_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          dm_cva_cid_count: "$dm_cva_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        dm_cva_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        dm_cva_cid_count: 1,
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
      { $unwind: "$dm_cva_cid_count" },
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

async function dmPatientCount({ area, province, district, hcode, months }) {
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
        dm_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          dm_cid_count: "$dm_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        dm_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        dm_cid_count: 1,
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
      { $unwind: "$dm_cid_count" },
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
        dm_patient: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].dm_patient;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = {
  dmPatientRepository,
  hgPatientCount,
  dmCkdPatientCount,
  dmAcsPatientCount,
  dmCvaPatientCount,
  dmPatientCount,
  getDataFromTempTable,
};
