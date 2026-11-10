"use strict";

require("dotenv").config();

const path = require("node:path");

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4005,
  serviceName: process.env.SERVICE_NAME || "integration-service",
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL || "",
  timeoutMs: 5000,
  payrollServiceUrl: process.env.PAYROLL_SERVICE_URL || "http://localhost:4004",
  workServiceUrl: process.env.WORK_SERVICE_URL || "http://localhost:4003",
  storageDir: path.resolve(process.env.STORAGE_DIR || "./storage"),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/+$/, ""),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 10 * 1024 * 1024,
};
