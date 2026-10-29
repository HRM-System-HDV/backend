"use strict";

// Xác thực JWT tại gateway (TECHS.md §6.3): kiểm tra chữ ký bằng JWT_SECRET
// dùng chung với identity-service, không truy vấn CSDL. Hỗ trợ cookie
// phiên `hrm-session` và header `Authorization: Bearer <token>`.
// Tuyến công khai (login/refresh/forgot-password/health/WSDL) được bỏ qua.
const jwt = require("jsonwebtoken");
const config = require("../config");

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
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Vui lòng đăng nhập để tiếp tục" },
      });
    }
    try {
      const payload = jwt.verify(token, secret);
      if (payload.type === "refresh") {
        return res.status(401).json({
          error: { code: "UNAUTHORIZED", message: "Phiên đăng nhập không hợp lệ" },
        });
      }
      req.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        branchSlug: payload.branchSlug,
      };
      return next();
    } catch (e) {
      return res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "Phiên đăng nhập đã hết hạn" },
      });
    }
  };
}

module.exports = { createAuthMiddleware };
