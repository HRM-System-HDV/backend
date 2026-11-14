"use strict";

// Xác thực JWT tại gateway (TECHS.md §6.3): kiểm tra chữ ký bằng JWT_SECRET
// dùng chung với identity-service, không truy vấn CSDL. Hỗ trợ cookie
// phiên `hrm-session` và header `Authorization: Bearer <token>`.
// Tuyến công khai (login/refresh/forgot-password/health/WSDL) được bỏ qua.
const jwt = require("jsonwebtoken");
const config = require("../config");
const { sendError } = require("../utils/soapFault");

function createAuthMiddleware(options = {}) {
  const secret = options.secret || config.jwtSecret;
  const publicPaths = options.publicPaths || config.publicPaths;

  function isPublic(req) {
    return publicPaths.some((p) => {
      if (p.method && p.method !== req.method) return false;
      if (p.exact) return req.path === p.path;
      return req.path === p.path || req.path.startsWith(`${p.path}/`);
    });
  }

  return function authMiddleware(req, res, next) {
    if (isPublic(req)) return next();
    const fromCookie = req.cookies ? req.cookies[config.cookieName] : null;
    const header = req.headers.authorization || "";
    const fromHeader = header.startsWith("Bearer ") ? header.slice(7) : null;
    const token = fromCookie || fromHeader;
    if (!token) {
      return sendError(req, res, 401, "UNAUTHORIZED", "Vui lòng đăng nhập để tiếp tục");
    }
    try {
      const payload = jwt.verify(token, secret);
      if (payload.type === "refresh") {
        return sendError(req, res, 401, "UNAUTHORIZED", "Phiên đăng nhập không hợp lệ");
      }
      const role = payload.role || payload.systemRole;
      if (!payload.userId || !["admin", "manager", "staff"].includes(role)) {
        return sendError(req, res, 401, "UNAUTHORIZED", "Danh tính đăng nhập không hợp lệ");
      }
      if (role === "staff" && (fromCookie || payload.clientPlatform !== "mobile" || req.clientPlatform !== "mobile")) {
        return sendError(req, res, 403, "FORBIDDEN", "Nhân viên chỉ được đăng nhập trên ứng dụng Mobile");
      }
      req.user = {
        userId: payload.userId,
        employeeId: payload.employeeId || null,
        email: payload.email,
        name: payload.name || null,
        role,
        branchId: payload.branchId || null,
        clientPlatform: payload.clientPlatform || "web",
      };
      return next();
    } catch (e) {
      return sendError(req, res, 401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn");
    }
  };
}

module.exports = { createAuthMiddleware };
