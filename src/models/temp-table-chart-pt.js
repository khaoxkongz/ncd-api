const { db } = require("../lib/mongo");

const COLLECTION_NAME_TEMP_CHART_PT = "NCD_Summary_Temp_Chart_PT";

async function createCollection() {
  try {
    await db.createCollection(COLLECTION_NAME_TEMP_CHART_PT);
  } catch (error) {
    if (error.code === 48) {
      return true;
    } else {
      throw error;
    }
  }
}

module.exports = {
  COLLECTION_NAME_TEMP_CHART_PT,
  createCollection,
};
