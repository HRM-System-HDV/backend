"use strict";

require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT || "4002", 10),
  serviceName: process.env.SERVICE_NAME || "organization-service",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
  identityUrl: process.env.IDENTITY_URL || "http://localhost:4001",
};
