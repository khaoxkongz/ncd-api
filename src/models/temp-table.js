const { db } = require("../lib/mongo");

const COLLECTION_NAME_TEMP = "NCD_Summary_Temp_Table";

async function createCollection() {
  try {
    await db.createCollection(COLLECTION_NAME_TEMP);
  } catch (error) {
    if (error.code === 48) {
      return true;
    } else {
      throw error;
    }
  }
}

module.exports = {
  COLLECTION_NAME_TEMP,
  createCollection,
};
