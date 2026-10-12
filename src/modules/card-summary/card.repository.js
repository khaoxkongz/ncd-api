/* eslint-disable prettier/prettier */
const { db } = require("../../lib/mongo");
const { COLLECTION_NAME } = require("../../models/ncd-summary");
const { COLLECTION_NAME_TEMP } = require("../../models/temp-table");

async function cardRepository({ startDate, endDate, area, province, district, hcode }) {
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
        hcode_count: {
          $addToSet: "$hcode",
        },
        service_count: {
          $sum: {
            $add: [
              "$dm_uid_count",
              "$ht_uid_count",
              "$copd_uid_count",
              "$ca_uid_count",
              "$psy_uid_count",
              "$hd_cvd_uid_count",
            ],
          },
        },
        patient_count: {
          $sum: {
            $add: [
              "$dm_cid_count",
              "$ht_cid_count",
              "$copd_cid_count",
              "$ca_cid_count",
              "$psy_cid_count",
              "$hd_cvd_cid_count",
            ],
          },
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
        hcode_count: { $size: "$hcode_count" },
        service_count: 1,
        patient_count: 1,
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

async function cardRepositoryV2({ startDate, endDate, area, province, district, hcode }) {
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
        hcode_count: {
          $addToSet: "$hcode",
        },
        service_count: {
          $sum: {
            $add: [
              "$dm_uid_count",
              "$ht_uid_count",
              "$copd_uid_count",
              "$ca_uid_count",
              "$psy_uid_count",
              "$hd_cvd_uid_count",
            ],
          },
        },
        // patient_count: {
        //   $sum: {
        //     $add: [
        //       "$dm_cid_count",
        //       "$ht_cid_count",
        //       "$copd_cid_count",
        //       "$ca_cid_count",
        //       "$psy_cid_count",
        //       "$hd_cvd_cid_count",
        //     ],
        //   },
        // },
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
        hcode_count: { $size: "$hcode_count" },
        service_count: 1,
        // patient_count: 1,
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

async function countPatient({ startDate, endDate, area, province, district, hcode }) {
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
        cid_list: {
          $setUnion: [
            "$dm_cid_count",
            "$ht_cid_count",
            "$copd_cid_count",
            "$ca_cid_count",
            "$psy_cid_count",
            "$hd_cvd_cid_count",
          ],
        },
      },
    };

    const agg = [
      matchStage,
      projectStage,
      { $unwind: "$cid_list" },
      { $group: { _id: "$cid_list" } },
      {
        $count: "patient",
      },
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
        card_summary: 1,
      },
    };
    const agg = [projectStage];

    const result = await collection.aggregate(agg).toArray();
    return result[0].card_summary;
  } catch (error) {
    console.error("Error executing aggregation:", error);
  }
}

module.exports = { cardRepository, cardRepositoryV2, countPatient, getDataFromTempTable };
