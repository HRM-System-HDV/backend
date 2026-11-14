"use strict";

require("dotenv").config();

if (process.env.NODE_ENV === "production") {
  const jwtSecret = process.env.JWT_SECRET;
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!jwtSecret || jwtSecret.startsWith("dev_only_")) {
    console.error("[FATAL] Production startup validation failed: JWT_SECRET is missing or using insecure default value.");
    process.exit(1);
  }
  if (!internalToken || internalToken.startsWith("dev_only_")) {
    console.error("[FATAL] Production startup validation failed: INTERNAL_API_TOKEN is missing or using insecure default value.");
    process.exit(1);
  }
}

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
  // Secret dùng chung cho gọi nội bộ giữa các service (vd: sync-employee).
  internalToken: required("INTERNAL_API_TOKEN", "dev_only_internal_token_thay_khi_deploy"),
  // Access token 7 ngày (quyết định chủ sở hữu 12/11/2026). Đánh đổi: gateway chỉ
  // verify chữ ký nên thu hồi (đổi role/chi nhánh, đăng xuất, chặn thiết bị) chỉ có
  // tác dụng với refresh token + device session (xem revokeSessions ở
  // src/services/AuthService.js:83-95); access token đã cấp vẫn sống tới hạn.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
};
