const { env } = require("./env");
const { initializePatientsBackend } = require("./modules/patients/backend");

void initializePatientsBackend().then(() => {
  require("./app").listen(env.PORT, () => {
    console.log(`Listening: http://localhost:${env.PORT}`);
  });
});
