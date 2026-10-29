"use strict";

require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT || "4000", 10),
  serviceName: process.env.SERVICE_NAME || "api-gateway",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
  timeoutMs: parseInt(process.env.PROXY_TIMEOUT_MS || "5000", 10),
  // JWT_SECRET dùng chung với identity-service để verify chữ ký, không truy vấn CSDL.
  jwtSecret: process.env.JWT_SECRET || "dev_only_secret_thay_khi_deploy",
  cookieName: process.env.COOKIE_NAME || "hrm-session",
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "300", 10),
  // Tuyến công khai không yêu cầu token.
  publicPaths: [
    { method: "POST", path: "/api/auth/login", exact: true },
    { method: "POST", path: "/api/auth/refresh", exact: true },
    { method: "POST", path: "/api/auth/forgot-password", exact: true },
    { method: "POST", path: "/api/auth/sync-employee", exact: true },
    { method: "GET", path: "/soap/payroll", exact: false },
  ],
  targets: {
    identity: process.env.IDENTITY_URL || "http://localhost:4001",
    organization: process.env.ORGANIZATION_URL || "http://localhost:4002",
    work: process.env.WORK_URL || "http://localhost:4003",
    payroll: process.env.PAYROLL_URL || "http://localhost:4004",
    integration: process.env.INTEGRATION_URL || "http://localhost:4005",
  },
};
