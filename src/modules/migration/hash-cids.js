const { env } = require("../../env");
const { db } = require("../../lib/mongo");
const { sendMigrationUpdate } = require("../../lib/discord");
const { hashCid } = require("../../lib/utils");

async function hashAllCidsInCollection(collectionName, batchSize = 1000) {
  const collection = db.collection(collectionName);

  const filter = {
    dm_cid_count: { $exists: true, $ne: null },
    ht_cid_count: { $exists: true, $ne: null },
    copd_cid_count: { $exists: true, $ne: null },
    ca_cid_count: { $exists: true, $ne: null },
    psy_cid_count: { $exists: true, $ne: null },
    hd_cvd_cid_count: { $exists: true, $ne: null },
    hg_cid_count: { $exists: true, $ne: null },
    dm_ckd_cid_count: { $exists: true, $ne: null },
    dm_acs_cid_count: { $exists: true, $ne: null },
    dm_cva_cid_count: { $exists: true, $ne: null },
    lung_ca_cid_count: { $exists: true, $ne: null },
    breast_ca_cid_count: { $exists: true, $ne: null },
    cervical_ca_cid_count: { $exists: true, $ne: null },
    liver_ca_cid_count: { $exists: true, $ne: null },
    colorectal_ca_cid_count: { $exists: true, $ne: null },
  };

  const options = {
    sort: { _id: 1 },
    projection: {
      _id: 1,
      dm_cid_count: 1,
      ht_cid_count: 1,
      copd_cid_count: 1,
      ca_cid_count: 1,
      psy_cid_count: 1,
      hd_cvd_cid_count: 1,
      hg_cid_count: 1,
      dm_ckd_cid_count: 1,
      dm_acs_cid_count: 1,
      dm_cva_cid_count: 1,
      lung_ca_cid_count: 1,
      breast_ca_cid_count: 1,
      cervical_ca_cid_count: 1,
      liver_ca_cid_count: 1,
      colorectal_ca_cid_count: 1,
    },
  };

  let processed = 0;
  let cursor = collection.find(filter, options);
  const total = await collection.countDocuments(filter);

  await sendMigrationUpdate({
    channelId: env.DISCORD_CHANNEL_ID_PROGRESS,
    type: "Progress",
    message: `Hashing ${total} documents with CIDs in ${collectionName}`,
  });

  // Process in batches
  while (await cursor.hasNext()) {
    const batch = [];

    // Collect a batch of documents to update
    for (let i = 0; i < batchSize && (await cursor.hasNext()); i++) {
      const doc = await cursor.next();
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              dm_cid_count: doc.dm_cid_count.map(hashCid),
              ht_cid_count: doc.ht_cid_count.map(hashCid),
              copd_cid_count: doc.copd_cid_count.map(hashCid),
              ca_cid_count: doc.ca_cid_count.map(hashCid),
              psy_cid_count: doc.psy_cid_count.map(hashCid),
              hd_cvd_cid_count: doc.hd_cvd_cid_count.map(hashCid),
              hg_cid_count: doc.hg_cid_count.map(hashCid),
              dm_ckd_cid_count: doc.dm_ckd_cid_count.map(hashCid),
              dm_acs_cid_count: doc.dm_acs_cid_count.map(hashCid),
              dm_cva_cid_count: doc.dm_cva_cid_count.map(hashCid),
              lung_ca_cid_count: doc.lung_ca_cid_count.map(hashCid),
              breast_ca_cid_count: doc.breast_ca_cid_count.map(hashCid),
              cervical_ca_cid_count: doc.cervical_ca_cid_count.map(hashCid),
              liver_ca_cid_count: doc.liver_ca_cid_count.map(hashCid),
              colorectal_ca_cid_count: doc.colorectal_ca_cid_count.map(hashCid),
            },
          },
        },
      });
    }

    // Execute the batch update
    if (batch.length > 0) {
      const result = await collection.bulkWrite(batch);
      processed += result.modifiedCount;
      await sendMigrationUpdate({
        channelId: env.DISCORD_CHANNEL_ID_PROGRESS,
        type: "Progress",
        message: `Hashed ${processed}/${total} documents in ${collectionName}`,
      });
    }
  }

  await sendMigrationUpdate({
    channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
    type: "Complete",
    message: `Successfully hashed ${processed} documents with CIDs in ${collectionName}`,
  });
  return processed;
}

module.exports = {
  hashAllCidsInCollection,
};
