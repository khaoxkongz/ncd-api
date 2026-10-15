const CATEGORIES = Object.freeze(
  [
    ["DM", "dm", "โรคเบาหวาน"],
    ["HT", "ht", "โรคความดันโลหิตสูง"],
    ["COPD", "copd", "โรคปอดอุดกั้นเรื้อรัง"],
    ["CA", "ca", "โรคมะเร็ง"],
    ["PSY", "psy", "สุขภาพจิต"],
    ["HD_CVD", "hd_cvd", "โรคหัวใจและหลอดเลือด"],
    ["DM_HG", "hg"],
    ["DM_CKD", "dm_ckd"],
    ["DM_ACS", "dm_acs"],
    ["DM_CVA", "dm_cva"],
    ["CA_LUNG", "lung_ca"],
    ["CA_BREAST", "breast_ca"],
    ["CA_CERVICAL", "cervical_ca"],
    ["CA_LIVER", "liver_ca"],
    ["CA_COLORECTAL", "colorectal_ca"],
  ].map(([id, field, label]) =>
    Object.freeze({
      id,
      field: `${field}_cid_count`,
      service: `${field}_uid_count`,
      expense: `${field}_expense`,
      label,
    })
  )
);
const VERSIONS = Object.freeze({
  schema: "patients-daily-and-stored-months-v1",
  dictionary: "mongo-equivalence-v1",
  codec: "roaring-2.7.0-portable",
  arithmetic: "expense-v1",
  serviceArithmetic: "baseline-services-v1",
  preparedStored: "stored-scopes-v1",
  card: "daily-card-v1",
  dateUtc: "date-utc-months-v1",
  preparedDateUtc: "date-utc-scopes-v1",
});
const COLLECTIONS = Object.freeze({
  generations: "patients_generations",
  identity: "patients_identity",
  daily: "patients_daily",
  months: "patients_month_atoms",
  scopes: "patients_scopes",
  monthScopes: "patients_month_scopes",
  dateMonths: "patients_date_month_atoms",
  dateMonthScopes: "patients_date_month_scopes",
  chunks: "patients_bitmap_chunks",
  directory: "patients_bitmap_directory",
  snapshots: "patients_snapshots",
});
const BSON_OPTIONS = Object.freeze({
  promoteValues: false,
  promoteLongs: false,
  promoteBuffers: false,
  bsonRegExp: true,
});
const BLOCK_SIZE = 2n ** 26n;

module.exports = { CATEGORIES, VERSIONS, COLLECTIONS, BSON_OPTIONS, BLOCK_SIZE };
