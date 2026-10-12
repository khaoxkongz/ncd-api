const { COLLECTION_NAME } = require("../../models/ncd-summary");

function pipeline(startDate, endDate) {
  return [
    {
      $match: {
        hcode: { $ne: "", $exists: true },
        area: { $ne: "", $exists: true },
        province: { $ne: "", $exists: true },
        district: { $ne: "", $exists: true },
        status: { $ne: "reclaimed", $exists: true },
        claim_date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $project: {
        diag_nosis: 1,
        hcode: 1,
        claim_date: 1,
        hname: 1,
        area: 1,
        province: 1,
        district: 1,
        cid: 1,
        transaction_uid: 1,
        total: 1,
      },
    },
    {
      $addFields: {
        total_amount: {
          $toDouble: {
            $cond: {
              if: {
                $or: [
                  { $eq: ["$total", "NaN"] },
                  { $eq: ["$total", null] },
                  {
                    $not: {
                      $regexMatch: {
                        input: "$total",
                        regex: /^[\d,.-]+$/,
                      },
                    },
                  },
                  {
                    $lt: [
                      {
                        $toDouble: {
                          $replaceAll: {
                            input: { $ifNull: ["$total", "0"] },
                            find: ",",
                            replacement: "",
                          },
                        },
                      },
                      0,
                    ],
                  },
                ],
              },
              then: 0,
              else: {
                $toDouble: {
                  $replaceAll: {
                    input: { $ifNull: ["$total", "0"] },
                    find: ",",
                    replacement: "",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $facet: {
        dm: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $regex: "^E1[0-4][0-9]?$" } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              dm_cid_count: { $addToSet: "$cid" },
              dm_uid_count: { $addToSet: "$transaction_uid" },
              dm_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              dm_cid_count: 1,
              dm_uid_count: { $size: "$dm_uid_count" },
              dm_expense: 1,
            },
          },
        ],
        ht: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $regex: "^I1[0-5][0-9]?$" } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              ht_cid_count: { $addToSet: "$cid" },
              ht_uid_count: { $addToSet: "$transaction_uid" },
              ht_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              ht_cid_count: 1,
              ht_uid_count: { $size: "$ht_uid_count" },
              ht_expense: 1,
            },
          },
        ],
        copd: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $regex: "^J4[0-7][0-9]?$" } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              copd_cid_count: { $addToSet: "$cid" },
              copd_uid_count: { $addToSet: "$transaction_uid" },
              copd_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              copd_cid_count: 1,
              copd_uid_count: { $size: "$copd_uid_count" },
              copd_expense: 1,
            },
          },
        ],
        ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $regex: "^C(?:[0-9][0-6]|96)[0-9]?$" } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              ca_cid_count: { $addToSet: "$cid" },
              ca_uid_count: { $addToSet: "$transaction_uid" },
              ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              ca_cid_count: 1,
              ca_uid_count: { $size: "$ca_uid_count" },
              ca_expense: 1,
            },
          },
        ],
        psy: [
          {
            $match: {
              $or: [
                { diag_nosis: { $elemMatch: { diag: { $regex: "^F([0-9]{1,2}|10[0-9])$" } } } },
                { diag_nosis: { $elemMatch: { diag: "G47" } } },
              ],
            },
          },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              psy_cid_count: { $addToSet: "$cid" },
              psy_uid_count: { $addToSet: "$transaction_uid" },
              psy_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              psy_cid_count: 1,
              psy_uid_count: { $size: "$psy_uid_count" },
              psy_expense: 1,
            },
          },
        ],
        hd_cvd: [
          {
            $match: {
              diag_nosis: {
                $elemMatch: {
                  diag: {
                    $in: [
                      // Heart diseases
                      "I01",
                      "I020",
                      "I05",
                      "I06",
                      "I07",
                      "I08",
                      "I09",
                      "I20",
                      "I21",
                      "I22",
                      "I23",
                      "I24",
                      "I25",
                      "I26",
                      "I270",
                      "I60",
                      "I61",
                      "I62",
                      "I63",
                      "I64",
                      "I65",
                      "I66",
                      "I67",
                      "I68",
                      "I69",
                      "I11",
                      "I34",
                      "I35",
                      "I36",
                      "I37",
                      "B332",
                      "I40",
                      "I41",
                      "I42",
                      "I43",
                      "I514",
                      "I515",
                      "I48",
                      "I71",
                      "I70",
                      "I73",
                      "I33",
                      "I38",
                      "I398",
                      // "I10",
                      // "I15",
                      "I28",
                      "I30",
                      "I31",
                      "I32",
                      "I390",
                      "I391",
                      "I392",
                      "I393",
                      "I394",
                      "I44",
                      "I45",
                      "I46",
                      "I47",
                      "I49",
                      "I516",
                      "I517",
                      "I518",
                      "I519",
                      "I52",
                      "I72",
                      "I174",
                      "I77",
                      "I78",
                      "I79",
                      "I80",
                      "I81",
                      "I82",
                      "I83",
                      "I84",
                      "I86",
                      "I87",
                      "I88",
                      "I89",
                      "I95",
                      "I97",
                      "I988",
                      "I99",
                      // Cerebrovascular diseases (G45-G46)
                      "G45",
                      "G450",
                      "G451",
                      "G452",
                      "G453",
                      "G454",
                      "G455",
                      "G456",
                      "G457",
                      "G458",
                      "G459",
                      "G46",
                      "G460",
                      "G461",
                      "G462",
                      "G463",
                      "G464",
                      "G465",
                      "G466",
                      "G467",
                      "G468",
                      // Additional I26-I27 series
                      "I260",
                      "I261",
                      "I262",
                      "I263",
                      "I264",
                      "I265",
                      "I266",
                      "I267",
                      "I268",
                      "I269",
                      "I27",
                      "I272",
                      "I273",
                      "I274",
                      "I275",
                      "I276",
                      "I277",
                      "I278",
                      "I279",
                      // I49-I51 series
                      "I490",
                      "I491",
                      "I492",
                      "I493",
                      "I494",
                      "I495",
                      "I496",
                      "I497",
                      "I498",
                      "I499",
                      "I50",
                      "I500",
                      "I501",
                      "I502",
                      "I503",
                      "I504",
                      "I505",
                      "I506",
                      "I507",
                      "I508",
                      "I509",
                      "I51",
                      "I510",
                      "I511",
                      "I512",
                      "I513",
                    ],
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              hd_cvd_cid_count: { $addToSet: "$cid" },
              hd_cvd_uid_count: { $addToSet: "$transaction_uid" },
              hd_cvd_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              hd_cvd_cid_count: 1,
              hd_cvd_uid_count: { $size: "$hd_cvd_uid_count" },
              hd_cvd_expense: 1,
            },
          },
        ],
        hg: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $in: ["E101", "E111", "E121", "E131", "E141"] } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              hg_cid_count: { $addToSet: "$cid" },
              hg_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              hg_cid_count: 1,
              hg_expense: 1,
            },
          },
        ],
        dm_ckd: [
          {
            $match: {
              $or: [
                {
                  $and: [
                    {
                      diag_nosis: {
                        $elemMatch: {
                          diag: { $in: ["E10", "E11", "E12", "E13", "E14"] },
                          dx_type: "1",
                        },
                      },
                    },
                    {
                      diag_nosis: {
                        $elemMatch: {
                          diag: "N18",
                          dx_type: { $ne: "1" },
                        },
                      },
                    },
                  ],
                },
                {
                  diag_nosis: {
                    $elemMatch: {
                      diag: { $in: ["E102", "E112", "E122", "E132", "E142"] },
                      dx_type: "1",
                    },
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              dm_ckd_cid_count: { $addToSet: "$cid" },
              dm_ckd_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              dm_ckd_cid_count: 1,
              dm_ckd_expense: 1,
            },
          },
        ],
        dm_acs: [
          {
            $match: {
              $and: [
                {
                  diag_nosis: {
                    $elemMatch: {
                      diag: { $in: ["E10", "E11", "E12", "E13", "E14"] },
                      dx_type: "1",
                    },
                  },
                },
                {
                  diag_nosis: {
                    $elemMatch: {
                      diag: { $in: ["I20", "I21", "I22", "I23", "I24", "I25"] },
                      dx_type: { $ne: "1" },
                    },
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              dm_acs_cid_count: { $addToSet: "$cid" },
              dm_acs_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              dm_acs_cid_count: 1,
              dm_acs_expense: 1,
            },
          },
        ],
        dm_cva: [
          {
            $match: {
              $and: [
                {
                  diag_nosis: {
                    $elemMatch: {
                      diag: { $in: ["E10", "E11", "E12", "E13", "E14"] },
                      dx_type: "1",
                    },
                  },
                },
                {
                  diag_nosis: {
                    $elemMatch: {
                      diag: { $in: ["I63", "I65", "I66", "I693"] },
                      dx_type: { $ne: "1" },
                    },
                  },
                },
              ],
            },
          },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              dm_cva_cid_count: { $addToSet: "$cid" },
              dm_cva_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              dm_cva_cid_count: 1,
              dm_cva_expense: 1,
            },
          },
        ],
        lung_ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $in: ["C34", "C340", "C341", "C349"] } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              lung_ca_cid_count: { $addToSet: "$cid" },
              lung_ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              lung_ca_cid_count: 1,
              lung_ca_expense: 1,
            },
          },
        ],
        breast_ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $in: ["C50", "C500", "C501", "C509"] } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              breast_ca_cid_count: { $addToSet: "$cid" },
              breast_ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              breast_ca_cid_count: 1,
              breast_ca_expense: 1,
            },
          },
        ],
        cervical_ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: { $in: ["C53", "C530", "C539"] } } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              cervical_ca_cid_count: { $addToSet: "$cid" },
              cervical_ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              cervical_ca_cid_count: 1,
              cervical_ca_expense: 1,
            },
          },
        ],
        liver_ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: "C22" } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              liver_ca_cid_count: { $addToSet: "$cid" },
              liver_ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              liver_ca_cid_count: 1,
              liver_ca_expense: 1,
            },
          },
        ],
        colorectal_ca: [
          { $match: { diag_nosis: { $elemMatch: { diag: "C18" } } } },
          {
            $group: {
              _id: { hcode: "$hcode", date: startDate },
              hname: { $first: "$hname" },
              area: { $first: "$area" },
              province: { $first: "$province" },
              district: { $first: "$district" },
              colorectal_ca_cid_count: { $addToSet: "$cid" },
              colorectal_ca_expense: { $sum: "$total_amount" },
            },
          },
          {
            $project: {
              _id: 0,
              hcode: "$_id.hcode",
              date: "$_id.date",
              hname: 1,
              area: 1,
              province: 1,
              district: 1,
              colorectal_ca_cid_count: 1,
              colorectal_ca_expense: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        data: {
          $setUnion: [
            "$dm",
            "$ht",
            "$copd",
            "$ca",
            "$psy",
            "$hd_cvd",
            "$hg",
            "$dm_ckd",
            "$dm_acs",
            "$dm_cva",
            "$lung_ca",
            "$breast_ca",
            "$cervical_ca",
            "$liver_ca",
            "$colorectal_ca",
          ],
        },
      },
    },
    {
      $unwind: "$data",
    },
    {
      $project: {
        hcode: "$data.hcode",
        hname: "$data.hname",
        date: "$data.date",
        area: "$data.area",
        province: "$data.province",
        district: "$data.district",
        dm_cid_count: { $ifNull: ["$data.dm_cid_count", []] },
        dm_uid_count: { $ifNull: ["$data.dm_uid_count", 0] },
        dm_expense: { $ifNull: ["$data.dm_expense", 0] },
        ht_cid_count: { $ifNull: ["$data.ht_cid_count", []] },
        ht_uid_count: { $ifNull: ["$data.ht_uid_count", 0] },
        ht_expense: { $ifNull: ["$data.ht_expense", 0] },
        copd_cid_count: { $ifNull: ["$data.copd_cid_count", []] },
        copd_uid_count: { $ifNull: ["$data.copd_uid_count", 0] },
        copd_expense: { $ifNull: ["$data.copd_expense", 0] },
        ca_cid_count: { $ifNull: ["$data.ca_cid_count", []] },
        ca_uid_count: { $ifNull: ["$data.ca_uid_count", 0] },
        ca_expense: { $ifNull: ["$data.ca_expense", 0] },
        psy_cid_count: { $ifNull: ["$data.psy_cid_count", []] },
        psy_uid_count: { $ifNull: ["$data.psy_uid_count", 0] },
        psy_expense: { $ifNull: ["$data.psy_expense", 0] },
        hd_cvd_cid_count: { $ifNull: ["$data.hd_cvd_cid_count", []] },
        hd_cvd_uid_count: { $ifNull: ["$data.hd_cvd_uid_count", 0] },
        hd_cvd_expense: { $ifNull: ["$data.hd_cvd_expense", 0] },
        hg_cid_count: { $ifNull: ["$data.hg_cid_count", []] },
        hg_expense: { $ifNull: ["$data.hg_expense", 0] },
        dm_ckd_cid_count: { $ifNull: ["$data.dm_ckd_cid_count", []] },
        dm_ckd_expense: { $ifNull: ["$data.dm_ckd_expense", 0] },
        dm_acs_cid_count: { $ifNull: ["$data.dm_acs_cid_count", []] },
        dm_acs_expense: { $ifNull: ["$data.dm_acs_expense", 0] },
        dm_cva_cid_count: { $ifNull: ["$data.dm_cva_cid_count", []] },
        dm_cva_expense: { $ifNull: ["$data.dm_cva_expense", 0] },
        lung_ca_cid_count: { $ifNull: ["$data.lung_ca_cid_count", []] },
        lung_ca_expense: { $ifNull: ["$data.lung_ca_expense", 0] },
        breast_ca_cid_count: { $ifNull: ["$data.breast_ca_cid_count", []] },
        breast_ca_expense: { $ifNull: ["$data.breast_ca_expense", 0] },
        cervical_ca_cid_count: { $ifNull: ["$data.cervical_ca_cid_count", []] },
        cervical_ca_expense: { $ifNull: ["$data.cervical_ca_expense", 0] },
        liver_ca_cid_count: { $ifNull: ["$data.liver_ca_cid_count", []] },
        liver_ca_expense: { $ifNull: ["$data.liver_ca_expense", 0] },
        colorectal_ca_cid_count: { $ifNull: ["$data.colorectal_ca_cid_count", []] },
        colorectal_ca_expense: { $ifNull: ["$data.colorectal_ca_expense", 0] },
      },
    },
    {
      $group: {
        _id: { hcode: "$hcode", date: "$date" },
        hname: { $first: "$hname" },
        area: { $first: "$area" },
        province: { $first: "$province" },
        district: { $first: "$district" },
        dm_cid_count: { $addToSet: "$dm_cid_count" },
        dm_uid_count: { $sum: "$dm_uid_count" },
        dm_expense: { $sum: "$dm_expense" },
        ht_cid_count: { $addToSet: "$ht_cid_count" },
        ht_uid_count: { $sum: "$ht_uid_count" },
        ht_expense: { $sum: "$ht_expense" },
        copd_cid_count: { $addToSet: "$copd_cid_count" },
        copd_uid_count: { $sum: "$copd_uid_count" },
        copd_expense: { $sum: "$copd_expense" },
        ca_cid_count: { $addToSet: "$ca_cid_count" },
        ca_uid_count: { $sum: "$ca_uid_count" },
        ca_expense: { $sum: "$ca_expense" },
        psy_cid_count: { $addToSet: "$psy_cid_count" },
        psy_uid_count: { $sum: "$psy_uid_count" },
        psy_expense: { $sum: "$psy_expense" },
        hd_cvd_cid_count: { $addToSet: "$hd_cvd_cid_count" },
        hd_cvd_uid_count: { $sum: "$hd_cvd_uid_count" },
        hd_cvd_expense: { $sum: "$hd_cvd_expense" },
        hg_cid_count: { $addToSet: "$hg_cid_count" },
        hg_expense: { $sum: "$hg_expense" },
        dm_ckd_cid_count: { $addToSet: "$dm_ckd_cid_count" },
        dm_ckd_expense: { $sum: "$dm_ckd_expense" },
        dm_acs_cid_count: { $addToSet: "$dm_acs_cid_count" },
        dm_acs_expense: { $sum: "$dm_acs_expense" },
        dm_cva_cid_count: { $addToSet: "$dm_cva_cid_count" },
        dm_cva_expense: { $sum: "$dm_cva_expense" },
        lung_ca_cid_count: { $addToSet: "$lung_ca_cid_count" },
        lung_ca_expense: { $sum: "$lung_ca_expense" },
        breast_ca_cid_count: { $addToSet: "$breast_ca_cid_count" },
        breast_ca_expense: { $sum: "$breast_ca_expense" },
        cervical_ca_cid_count: { $addToSet: "$cervical_ca_cid_count" },
        cervical_ca_expense: { $sum: "$cervical_ca_expense" },
        liver_ca_cid_count: { $addToSet: "$liver_ca_cid_count" },
        liver_ca_expense: { $sum: "$liver_ca_expense" },
        colorectal_ca_cid_count: { $addToSet: "$colorectal_ca_cid_count" },
        colorectal_ca_expense: { $sum: "$colorectal_ca_expense" },
      },
    },
    {
      $project: {
        _id: 0,
        hcode: "$_id.hcode",
        date: "$_id.date",
        year: { $year: { $toDate: "$_id.date" } },
        month: { $month: { $toDate: "$_id.date" } },
        created_at: new Date(),
        updated_at: new Date(),
        fiscal_year: {
          $cond: {
            if: { $gte: [{ $month: { $toDate: "$_id.date" } }, 10] },
            then: { $add: [{ $year: { $toDate: "$_id.date" } }, 1] },
            else: { $year: { $toDate: "$_id.date" } },
          },
        },
        hname: 1,
        area: 1,
        province: 1,
        district: 1,
        dm_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$dm_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        dm_uid_count: 1,
        dm_expense: 1,
        ht_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$ht_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        ht_uid_count: 1,
        ht_expense: 1,
        copd_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$copd_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        copd_uid_count: 1,
        copd_expense: 1,
        ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        ca_uid_count: 1,
        ca_expense: 1,
        psy_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$psy_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        psy_uid_count: 1,
        psy_expense: 1,
        hd_cvd_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$hd_cvd_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        hd_cvd_uid_count: 1,
        hd_cvd_expense: 1,
        hg_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$hg_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        hg_expense: 1,
        dm_ckd_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$dm_ckd_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        dm_ckd_expense: 1,
        dm_acs_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$dm_acs_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        dm_acs_expense: 1,
        dm_cva_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$dm_cva_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        dm_cva_expense: 1,
        lung_ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$lung_ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        lung_ca_expense: 1,
        breast_ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$breast_ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        breast_ca_expense: 1,
        cervical_ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$cervical_ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        cervical_ca_expense: 1,
        liver_ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$liver_ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        liver_ca_expense: 1,
        colorectal_ca_cid_count: {
          $filter: {
            input: {
              $reduce: {
                input: "$colorectal_ca_cid_count",
                initialValue: [],
                in: { $concatArrays: ["$$value", "$$this"] },
              },
            },
            as: "item",
            cond: { $ne: ["$$item", []] },
          },
        },
        colorectal_ca_expense: 1,
      },
    },
    {
      $merge: {
        into: COLLECTION_NAME,
        on: ["hcode", "date"],
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];
}

module.exports = {
  pipeline,
};
