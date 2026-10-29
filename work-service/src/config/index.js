"use strict";

require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT || "4003", 10),
  serviceName: process.env.SERVICE_NAME || "work-service",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
};
