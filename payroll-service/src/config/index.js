"use strict";

require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT || "4004", 10),
  serviceName: process.env.SERVICE_NAME || "payroll-service",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
  organizationUrl: process.env.ORGANIZATION_URL || "http://localhost:4002",
  workUrl: process.env.WORK_URL || "http://localhost:4003",
};
