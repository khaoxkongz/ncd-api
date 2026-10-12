const app = require("./app");
const { env } = require("./env");

app.listen(env.PORT, () => {
  console.log(`Listening: http://localhost:${env.PORT}`);
});
