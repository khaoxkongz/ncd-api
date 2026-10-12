const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const path = require("node:path");

const configureOpenApi = require("./lib/configure-open-api");
const middlewares = require("./middlewares");
const routes = require("./routes");

const app = express();

app.use(morgan("dev"));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/ncds_api", (_req, res) => res.json({ message: "Welcome NCD Dashboard 🦄🌈✨👋🌎🌍🌏✨🌈🦄" }));

configureOpenApi(app);

app.use("/ncds_api/api/v1", routes);

app.use(middlewares.notFound);
app.use(middlewares.errorHandler);

module.exports = app;
