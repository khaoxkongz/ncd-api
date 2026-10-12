const fs = require("node:fs");
const path = require("node:path");
const swaggerJsdoc = require("swagger-jsdoc");

// Ensure public directory exists
const publicDir = path.join(__dirname, "../../public");
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "NCD Dashboard API",
      version: "0.0.1",
      description: "API documentation for NCD Dashboard",
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Development server",
      },
      {
        url: "https://uat-fdh-dashboard.one.th",
        description: "Development server",
      },
    ],
  },
  apis: ["./src/modules/**/*.routes.js", "./src/routes/*.js"],
};

const openapiSpecification = swaggerJsdoc(options);
fs.writeFileSync(
  path.join(publicDir, "openapi.json"),
  JSON.stringify(openapiSpecification, null, 2),
);
