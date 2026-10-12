const { env } = require("../../env");
const { db } = require("../../lib/mongo");
const { formatDateAsString } = require("../../lib/utils");
const {
  initialize,
  destroy,
  sendMigrationUpdate,
} = require("../../lib/discord");
const {
  createCollection,
  COLLECTION_NAME,
} = require("../../models/ncd-summary");
const { pipeline } = require("./pipeline");
const { hashAllCidsInCollection } = require("./hash-cids");
const {
  temporaryCollections,
  temporaryChartPatientCollection,
} = require("../migration-temp-table/temp-table.service");

const transactionCollection = db.collection("FDH_Transaction");

const processingStartDate = new Date("2024-01-01T00:00:00.000Z");

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function getTransactionDatesByYear() {
  const currentDate = new Date();
  const transactionDatesByYear = {};

  function initializeYearlyTransactionDates(year) {
    transactionDatesByYear[year] = {
      january: [],
      february: [],
      march: [],
      april: [],
      may: [],
      june: [],
      july: [],
      august: [],
      september: [],
      october: [],
      november: [],
      december: [],
    };
  }

  let currentProcessingDate = new Date(processingStartDate);
  while (currentProcessingDate <= currentDate) {
    const year = currentProcessingDate.getFullYear();
    if (!transactionDatesByYear[year]) {
      initializeYearlyTransactionDates(year);
    }

    const monthName = monthNames[currentProcessingDate.getMonth()];
    transactionDatesByYear[year][monthName].push(
      new Date(currentProcessingDate),
    );

    const nextDate = currentProcessingDate.setDate(
      currentProcessingDate.getDate() + 1,
    );
    currentProcessingDate = new Date(nextDate);
  }

  return transactionDatesByYear;
}

async function processTransactionsForMonth(year, month, dates) {
  await sendMigrationUpdate({
    channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
    type: "Start",
    message: `Processing transactions for ${month} ${year}`,
    details: {
      progress: {
        current: 0,
        total: dates.length,
      },
    },
  });

  for (const date of dates) {
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    const formattedDate = formatDateAsString(date);

    dayStart.setUTCHours(0, 0, 0, 0);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const aggregationPipeline = pipeline(dayStart, dayEnd);

    try {
      await transactionCollection.aggregate(aggregationPipeline).toArray();
      await sendMigrationUpdate({
        channelId: env.DISCORD_CHANNEL_ID_PROGRESS,
        type: "Progress",
        message: `Processed transactions for ${formattedDate}`,
        details: {
          progress: {
            current: dates.indexOf(date) + 1,
            total: dates.length,
          },
        },
      });
    } catch (error) {
      await sendMigrationUpdate({
        channelId: env.DISCORD_CHANNEL_ID_ERROR,
        type: "Error",
        message: `Failed to process transactions for ${formattedDate}`,
        details: { error: error.message },
      });
    }
  }

  await sendMigrationUpdate({
    channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
    type: "Complete",
    message: `Completed processing transactions for ${month} ${year}`,
    details: {
      progress: {
        current: dates.length,
        total: dates.length,
      },
    },
  });
}

async function processTransactionsForYear(year, transactionDatesByYear) {
  await sendMigrationUpdate({
    channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
    type: "Start",
    message: `Processing transactions for year ${year}`,
    details: {
      progress: {
        current: 0,
        total: monthNames.length,
      },
    },
  });

  const monthProcessingPromises = monthNames.map((month) => {
    const transactionDates = transactionDatesByYear[year][month];
    if (transactionDates.length > 0) {
      return processTransactionsForMonth(year, month, transactionDates);
    }
    return Promise.resolve();
  });

  try {
    await Promise.all(monthProcessingPromises);
    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Complete",
      message: `Completed processing transactions for year ${year}`,
      details: {
        progress: {
          current: monthNames.length,
          total: monthNames.length,
        },
      },
    });
  } catch (error) {
    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_ERROR,
      type: "Error",
      message: `Failed to process transactions for year ${year}`,
      details: { error: error.message },
    });
    throw error;
  }
}

async function processAllTransactions() {
  await initialize();
  await createCollection();
  const startMigrationTime = new Date();
  const transactionDatesByYear = getTransactionDatesByYear();
  const yearsToProcess = Object.keys(transactionDatesByYear).map(Number).sort();

  try {
    for (const year of yearsToProcess) {
      await processTransactionsForYear(year, transactionDatesByYear);
    }
    const endMigrationTime = new Date();
    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Complete",
      message: "Successfully processed all transactions!",
      details: {
        time: {
          current: startMigrationTime,
          total: endMigrationTime - startMigrationTime,
        },
      },
    });

    const timeToHash = new Date();

    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Start",
      message: "Hashing sensitive CID data...",
    });
    const hashedCount = await hashAllCidsInCollection(COLLECTION_NAME);
    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Complete",
      message: `Successfully hashed ${hashedCount} documents with CIDs`,
      details: {
        time: {
          current: timeToHash,
          total: new Date() - timeToHash,
        },
      },
    });

    const timeToProcessTempTable = new Date();

    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Start",
      message: `Processing transactions for Temp Collection`,
    });

    await temporaryCollections();

    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Complete",
      message: `Successfully processed all transactions for Temp Collection`,
      details: {
        time: {
          current: timeToProcessTempTable,
          total: new Date() - timeToProcessTempTable,
        },
      },
    });

    const timeToProcessTempChartPt = new Date();

    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Start",
      message: `Processing transactions for Temp Collection`,
    });

    await temporaryChartPatientCollection();

    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_SUCCESS,
      type: "Complete",
      message: `Successfully processed all transactions for Temp Collection`,
      details: {
        time: {
          current: timeToProcessTempChartPt,
          total: new Date() - timeToProcessTempChartPt,
        },
      },
    });
  } catch (error) {
    const endMigrationTime = new Date();
    await sendMigrationUpdate({
      channelId: env.DISCORD_CHANNEL_ID_ERROR,
      type: "Error",
      message: "Failed to process transactions",
      details: {
        error: error.message,
        time: {
          current: startMigrationTime,
          total: endMigrationTime - startMigrationTime,
        },
      },
    });
  }

  await destroy();
}

module.exports = {
  processAllTransactions,
};
