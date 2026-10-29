"use strict";

require("dotenv").config();

function required(name, fallback) {
  const value = process.env[name] || fallback;
  return value;
}

module.exports = {
  port: parseInt(process.env.PORT || "4001", 10),
  serviceName: process.env.SERVICE_NAME || "identity-service",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: required("JWT_SECRET", "dev_only_secret_thay_khi_deploy"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
};
