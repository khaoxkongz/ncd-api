const { apiReference } = require("@scalar/express-api-reference");

module.exports = function configureOpenApi(app) {
  app.use(
    "/ncds_api/api-docs",
    apiReference({
      title: "NCD Dashboard API",
      version: "0.0.1",
      theme: "kepler",
      layout: "modern",
      defaultHttpClient: {
        targetKey: "javascript",
        clientKey: "fetch",
      },
      spec: {
        url: "/openapi.json",
      },
    })
  );
};
