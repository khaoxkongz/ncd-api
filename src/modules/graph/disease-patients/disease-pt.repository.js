const { db } = require("../../../lib/mongo");
const { COLLECTION_NAME } = require("../../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../../models/temp-table");

async function diseasePatientRepository({
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
        dm_cid_count: { $sum: "$dm_cid_count" },
        ht_cid_count: { $sum: "$ht_cid_count" },
        copd_cid_count: { $sum: "$copd_cid_count" },
        ca_cid_count: { $sum: "$ca_cid_count" },
        psy_cid_count: { $sum: "$psy_cid_count" },
        hd_cvd_cid_count: { $sum: "$hd_cvd_cid_count" },
      },
    };

    const projectStage = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        dm_cid_count: 1,
        ht_cid_count: 1,
        copd_cid_count: 1,
        ca_cid_count: 1,
        psy_cid_count: 1,
        hd_cvd_cid_count: 1,
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

async function htPatientCount({ area, province, district, hcode, months }) {
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
        ht_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          ht_cid_count: "$ht_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        ht_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        ht_cid_count: 1,
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
      { $unwind: "$ht_cid_count" },
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

async function copdPatientCount({ area, province, district, hcode, months }) {
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
        copd_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          copd_cid_count: "$copd_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        copd_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        copd_cid_count: 1,
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
      { $unwind: "$copd_cid_count" },
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

async function psyPatientCount({ area, province, district, hcode, months }) {
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
        psy_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          psy_cid_count: "$psy_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        psy_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        psy_cid_count: 1,
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
      { $unwind: "$psy_cid_count" },
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

async function hdCvdPatientCount({ area, province, district, hcode, months }) {
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
        hd_cvd_cid_count: 1,
      },
    };

    const groupStage = {
      $group: {
        _id: {
          year: "$year",
          month: "$month",
          hd_cvd_cid_count: "$hd_cvd_cid_count",
        },
      },
    };

    const countStage = {
      $group: {
        _id: {
          year: "$_id.year",
          month: "$_id.month",
        },
        hd_cvd_cid_count: { $sum: 1 },
      },
    };

    const projectStage2 = {
      $project: {
        _id: 0,
        year: "$_id.year",
        month: "$_id.month",
        hd_cvd_cid_count: 1,
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
      { $unwind: "$hd_cvd_cid_count" },
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
        disease_patient: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].disease_patient;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = {
  diseasePatientRepository,
  dmPatientCount,
  htPatientCount,
  copdPatientCount,
  caPatientCount,
  psyPatientCount,
  hdCvdPatientCount,
  getDataFromTempTable,
};
