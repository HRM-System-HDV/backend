"use strict";

require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4005,
  serviceName: process.env.SERVICE_NAME || "integration-service",
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL || "",
  timeoutMs: 5000,
  payrollServiceUrl: process.env.PAYROLL_SERVICE_URL || "http://localhost:4004",
  workServiceUrl: process.env.WORK_SERVICE_URL || "http://localhost:4003",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "dqpqiplhv",
    apiKey: process.env.CLOUDINARY_API_KEY || "896337341977173",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "7JAqSBiIvBAHPjUba6JKl80AmaM",
    fallbackSecret: "00IYdtnGKF62uQ9ky35X07TJ2ZI",
  },
};
