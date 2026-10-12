const { db } = require("../../lib/mongo");
const { COLLECTION_NAME_TEMP } = require("../../models/temp-table");
const { COLLECTION_NAME_TEMP_CHART_PT } = require("../../models/temp-table-chart-pt");

const { YEAR } = require("../../utils/constant");
const { cardServiceV2 } = require("../card-summary/card.service");
const { chartExpenseServiceV2 } = require("../bar-chart/expense/chart-ex.service");
const { chartPatientServiceV2 } = require("../bar-chart/patients/chart-pt.service");
const { caExpenseService } = require("../graph/ca-expense/ca-ex.service");
const { caPatientServiceV2 } = require("../graph/ca-patients/ca-pt.service");
const { diseaseExpenseService } = require("../graph/disease-expense/disease-ex.service");
const { diseasePatientServiceV2 } = require("../graph/disease-patients/disease-pt.service");
const { dmExpenseService } = require("../graph/dm-expense/dm-ex.service");
const { dmPatientServiceV2 } = require("../graph/dm-patients/dm-pt.service");

async function tempTableService(_req, res) {
  const startDate = new Date("2024-01-07T00:00:00.000Z");
  const endDate = new Date();
  const collection = db.collection(COLLECTION_NAME_TEMP);
  try {
    const [
      cardSummaryData,
      chartExpenseData,
      chartPatientData,
      diseaseExpenseData,
      diseasePatientData,
      dmExpenseData,
      dmPatientData,
      caExpenseData,
      caPatientData,
    ] = await Promise.all([
      cardServiceV2({ startDate, endDate }),
      chartExpenseServiceV2({ startDate, endDate }),
      chartPatientServiceV2({ startDate, endDate }),
      diseaseExpenseService({ year: YEAR }),
      diseasePatientServiceV2({ year: YEAR }),
      dmExpenseService({ year: YEAR }),
      dmPatientServiceV2({ year: YEAR }),
      caExpenseService({ year: YEAR }),
      caPatientServiceV2({ year: YEAR }),
    ]);

    const tempData = {
      key: "main",
      card_summary: cardSummaryData,
      chart_expense: chartExpenseData,
      chart_patient: chartPatientData,
      disease_expense: diseaseExpenseData,
      disease_patient: diseasePatientData,
      dm_expense: dmExpenseData,
      dm_patient: dmPatientData,
      ca_expense: caExpenseData,
      ca_patient: caPatientData,
      updated_at: new Date(),
    };

    await collection.replaceOne({ key: "main" }, tempData, { upsert: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

async function tempChartPtService(_req, res) {
  // const startDate = new Date("2024-10-01T00:00:00.000Z")
  const startDate = new Date("2024-01-07T00:00:00.000Z");
  const endDate = new Date();
  const collection = db.collection(COLLECTION_NAME_TEMP_CHART_PT);
  try {
    const chartPatientData = await chartPatientServiceV2({ startDate, endDate });

    const tempData = {
      key: "main",
      chart_patient: chartPatientData,
      updated_at: new Date(),
    };

    await collection.replaceOne({ key: "main" }, tempData, { upsert: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

async function temporaryCollections() {
  const startDate = new Date("2024-01-07T00:00:00.000Z");
  const endDate = new Date();
  const collection = db.collection(COLLECTION_NAME_TEMP);
  try {
    const [
      cardSummaryData,
      chartExpenseData,
      chartPatientData,
      diseaseExpenseData,
      diseasePatientData,
      dmExpenseData,
      dmPatientData,
      caExpenseData,
      caPatientData,
    ] = await Promise.all([
      cardServiceV2({ startDate, endDate }),
      chartExpenseServiceV2({ startDate, endDate }),
      chartPatientServiceV2({ startDate, endDate }),
      diseaseExpenseService({ year: YEAR }),
      diseasePatientServiceV2({ year: YEAR }),
      dmExpenseService({ year: YEAR }),
      dmPatientServiceV2({ year: YEAR }),
      caExpenseService({ year: YEAR }),
      caPatientServiceV2({ year: YEAR }),
    ]);

    const tempData = {
      key: "main",
      card_summary: cardSummaryData,
      chart_expense: chartExpenseData,
      chart_patient: chartPatientData,
      disease_expense: diseaseExpenseData,
      disease_patient: diseasePatientData,
      dm_expense: dmExpenseData,
      dm_patient: dmPatientData,
      ca_expense: caExpenseData,
      ca_patient: caPatientData,
      updated_at: new Date(),
    };

    await collection.replaceOne({ key: "main" }, tempData, { upsert: true });
  } catch (error) {
    console.error(error);
    return { status: false, message: "Internal server error" };
  }
}

async function temporaryChartPatientCollection() {
  // const startDate = new Date("2024-10-01T00:00:00.000Z")
  const startDate = new Date("2024-01-07T00:00:00.000Z");
  const endDate = new Date();
  const collection = db.collection(COLLECTION_NAME_TEMP_CHART_PT);

  try {
    const chartPatientData = await chartPatientServiceV2({ startDate, endDate });

    const tempData = {
      key: "main",
      chart_patient: chartPatientData,
      updated_at: new Date(),
    };

    await collection.replaceOne({ key: "main" }, tempData, { upsert: true });
  } catch (error) {
    console.error(error);
    return { status: false, message: "Internal server error" };
  }
}

module.exports = {
  tempTableService,
  tempChartPtService,
  temporaryCollections,
  temporaryChartPatientCollection,
};
