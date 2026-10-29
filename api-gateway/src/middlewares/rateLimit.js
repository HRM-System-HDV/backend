"use strict";

// Giới hạn tần suất tại gateway (TECHS.md §6.3): cửa sổ trượt trong bộ nhớ
// theo IP. Vượt quá trả 429 đúng envelope.
const config = require("../config");

function createRateLimitMiddleware(options = {}) {
  const windowMs = options.windowMs || config.rateLimitWindowMs;
  const max = options.max || config.rateLimitMax;
  const hits = new Map();

  function middleware(req, res, next) {
    // Tuyến công khai kiểm tra sức khỏe không tính vào hạn mức.
    if (req.path === "/health") return next();
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Quá nhiều yêu cầu, vui lòng thử lại sau" },
      });
    }
    return next();
  }

  // Lộ ra cho kiểm thử dọn trạng thái.
  middleware._reset = () => hits.clear();
  return middleware;
}

module.exports = { createRateLimitMiddleware };
