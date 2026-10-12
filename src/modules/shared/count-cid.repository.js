const { db } = require("../../lib/mongo");
const { COLLECTION_NAME } = require("../../models/ncd-summary");

async function countDmCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        dm_cid_count: {
          $setUnion: ["$dm_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$dm_cid_count" },
      { $group: { _id: "$dm_cid_count" } },
      {
        $count: "dm_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function countHtCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        ht_cid_count: {
          $setUnion: ["$ht_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$ht_cid_count" },
      { $group: { _id: "$ht_cid_count" } },
      {
        $count: "ht_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function countCopdCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        copd_cid_count: {
          $setUnion: ["$copd_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$copd_cid_count" },
      { $group: { _id: "$copd_cid_count" } },
      {
        $count: "copd_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function countCaCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        ca_cid_count: {
          $setUnion: ["$ca_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$ca_cid_count" },
      { $group: { _id: "$ca_cid_count" } },
      {
        $count: "ca_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function countPsyCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        psy_cid_count: {
          $setUnion: ["$psy_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$psy_cid_count" },
      { $group: { _id: "$psy_cid_count" } },
      {
        $count: "psy_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

async function countHdCvdCid({ startDate, endDate, area, province, district, hcode }) {
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

    const projectStage = {
      $project: {
        hd_cvd_cid_count: {
          $setUnion: ["$hd_cvd_cid_count"],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$hd_cvd_cid_count" },
      { $group: { _id: "$hd_cvd_cid_count" } },
      {
        $count: "hd_cvd_cid_count",
      },
    ];

    const result = await collection.aggregate(agg).toArray();
    return result[0];
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = { countDmCid, countHtCid, countCopdCid, countCaCid, countPsyCid, countHdCvdCid };
