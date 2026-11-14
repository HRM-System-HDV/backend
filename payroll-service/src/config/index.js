"use strict";

require("dotenv").config();
if (process.env.NODE_ENV === "production" && (!process.env.INTERNAL_API_TOKEN || process.env.INTERNAL_API_TOKEN.startsWith("dev_only_"))) throw new Error("Production cần INTERNAL_API_TOKEN riêng");

module.exports = {
  port: parseInt(process.env.PORT || "4004", 10),
  serviceName: process.env.SERVICE_NAME || "payroll-service",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
  organizationUrl: process.env.ORGANIZATION_URL || "http://localhost:4002",
  workUrl: process.env.WORK_URL || "http://localhost:4003",
  internalToken: process.env.INTERNAL_API_TOKEN || "dev_only_internal_token_thay_khi_deploy",
};
