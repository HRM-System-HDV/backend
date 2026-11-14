"use strict";

const { verifyToken } = require("../utils/jwt");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");

const COOKIE_NAME = "hrm-session";

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

// Các tuyến cá nhân của Identity tự verify token; service nghiệp vụ nhận danh tính tin cậy từ Gateway.
function sessionMiddleware(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedError("Thiếu phiên đăng nhập");
    const decoded = verifyToken(token);
    // Refresh token không được dùng thay access token (phân biệt bằng claim type=refresh).
    if (decoded.type === "refresh") {
      throw new UnauthorizedError("Token cung cấp không phải là access token");
    }
    if (decoded.role === "staff" && (decoded.clientPlatform !== "mobile" || req.cookies?.[COOKIE_NAME])) {
      throw new ForbiddenError("Nhân viên chỉ được truy cập từ Mobile");
    }
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      employeeId: decoded.employeeId || null,
      branchId: decoded.branchId || null,
      systemRole: decoded.systemRole || decoded.role,
      clientPlatform: decoded.clientPlatform,
      deviceSessionId: decoded.deviceSessionId,
    };
    return next();
  } catch (e) {
    if (e.name === "TokenExpiredError" || e.name === "JsonWebTokenError") {
      return next(new UnauthorizedError("Phiên đăng nhập hết hạn"));
    }
    return next(e);
  }
}

module.exports = { sessionMiddleware, COOKIE_NAME, extractToken };
