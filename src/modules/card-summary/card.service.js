const { cardRepository, cardRepositoryV2, countPatient, getDataFromTempTable } = require("./card.repository");

async function cardService(body) {
  try {
    const result = await cardRepository(body);

    if (!result || result.length === 0) {
      return [
        {
          service_count: 0,
          patient_count: 0,
          expense: 0,
          hcode_count: 0,
          avg_service: 0,
          avg_expense: 0,
        },
      ];
    }

    return result.map((item) => {
      const dm_expense = Number(item.dm_expense?.toFixed(2) || 0);
      const ht_expense = Number(item.ht_expense?.toFixed(2) || 0);
      const copd_expense = Number(item.copd_expense?.toFixed(2) || 0);
      const ca_expense = Number(item.ca_expense?.toFixed(2) || 0);
      const psy_expense = Number(item.psy_expense?.toFixed(2) || 0);
      const hd_cvd_expense = Number(item.hd_cvd_expense?.toFixed(2) || 0);

      const expense = Number(
        (dm_expense + ht_expense + copd_expense + ca_expense + psy_expense + hd_cvd_expense).toFixed(2)
      );

      const avg_service = item.patient_count > 0 ? Number((item.service_count / item.patient_count).toFixed(2)) : 0;
      const avg_expense = item.patient_count > 0 ? Number((expense / item.patient_count).toFixed(2)) : 0;

      return {
        service_count: item.service_count || 0,
        patient_count: item.patient_count || 0,
        expense,
        hcode_count: item.hcode_count || 0,
        avg_service,
        avg_expense,
      };
    });
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
}

async function cardServiceV2(body) {
  const endDate = new Date();
  const formattedDate = endDate.toISOString().split("T")[0];

  try {
    if (
      body.startDate == "2024-01-07" &&
      body.endDate == formattedDate &&
      body.area == "" &&
      body.province == "" &&
      body.district == "" &&
      body.hcode == ""
    ) {
      const result = await getDataFromTempTable();
      return result;
    }

    const [result, patientCount] = await Promise.all([cardRepositoryV2(body), countPatient(body)]);

    if (result.length === 0 && patientCount.length === 0) {
      return [
        {
          service_count: 0,
          patient_count: 0,
          expense: 0,
          hcode_count: 0,
          avg_service: 0,
          avg_expense: 0,
        },
      ];
    }

    return result.map((item) => {
      const dm_expense = Number(item.dm_expense?.toFixed(2) || 0);
      const ht_expense = Number(item.ht_expense?.toFixed(2) || 0);
      const copd_expense = Number(item.copd_expense?.toFixed(2) || 0);
      const ca_expense = Number(item.ca_expense?.toFixed(2) || 0);
      const psy_expense = Number(item.psy_expense?.toFixed(2) || 0);
      const hd_cvd_expense = Number(item.hd_cvd_expense?.toFixed(2) || 0);
      const expense = Number(
        (dm_expense + ht_expense + copd_expense + ca_expense + psy_expense + hd_cvd_expense).toFixed(2)
      );

      const patient_count = patientCount[0].patient;
      const avg_service = patient_count > 0 ? Number((item.service_count / patient_count).toFixed(2)) : 0;
      const avg_expense = patient_count > 0 ? Number((expense / patient_count).toFixed(2)) : 0;

      return {
        service_count: item.service_count || 0,
        patient_count,
        expense,
        hcode_count: item.hcode_count || 0,
        avg_service,
        avg_expense,
      };
    });
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
}

module.exports = { cardService, cardServiceV2 };
