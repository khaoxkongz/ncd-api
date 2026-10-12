const { db } = require("../lib/mongo");

const COLLECTION_NAME = "NCD_SUMMARY";

async function createCollection() {
  try {
    await db.createCollection(COLLECTION_NAME);

    await db.collection(COLLECTION_NAME).createIndex({ date: 1 });
    await db
      .collection(COLLECTION_NAME)
      .createIndex({ date: 1, hcode: 1 }, { unique: true });
    await db.collection(COLLECTION_NAME).createIndex({ date: 1, district: 1 });
    await db.collection(COLLECTION_NAME).createIndex({ date: 1, area: 1 });
    await db.collection(COLLECTION_NAME).createIndex({ date: 1, province: 1 });
    await db
      .collection(COLLECTION_NAME)
      .createIndex({ date: 1, district: 1, area: 1 });
    await db
      .collection(COLLECTION_NAME)
      .createIndex({ date: 1, district: 1, area: 1, province: 1 });
    await db
      .collection(COLLECTION_NAME)
      .createIndex({ date: 1, hcode: 1, district: 1, area: 1, province: 1 });
  } catch (error) {
    if (error.code === 48) {
      return true;
    } else {
      throw error;
    }
  }
}

module.exports = {
  COLLECTION_NAME,
  createCollection,
};
