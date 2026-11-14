"use strict";

// Gateway là nguồn tin cậy DUY NHẤT về nền tảng client và địa chỉ IP của client.
//
// Vì sao: client tự khai "tôi là mobile" (header x-client-platform hoặc body
// clientPlatform) thì nhân viên (staff) sẽ lấy được token mobile ngay trên
// trình duyệt và vượt qua luật "nhân viên chỉ được đăng nhập trên Mobile"
// (RULES.md §7). Vì vậy:
//   1. Xóa mọi header client tự gửi có thể giả mạo.
//   2. Gateway tự tính nền tảng từ dấu hiệu trình duyệt (Origin / User-Agent).
//   3. Gateway gắn lại header đã chuẩn hóa xuống service phía sau.
const CLIENT_HEADERS_TO_STRIP = ["x-client-platform", "x-client-ip", "x-forwarded-for"];

// User-Agent của trình duyệt thật. Ứng dụng Flutter/Dart gửi
// "Dart/3.x (dart:io)" nên không khớp -> coi là mobile.
const BROWSER_USER_AGENT = /(mozilla|chrome|safari|edge|edg\/|firefox|opera|opr\/|msie|trident)/i;

/**
 * Suy ra nền tảng từ request:
 * - có header Origin không rỗng  -> web (trình duyệt gửi Origin khi gọi CORS).
 * - User-Agent là trình duyệt   -> web.
 * - còn lại                     -> mobile (app Flutter, client nội bộ, công cụ CLI).
 */
function resolveClientPlatform(req = {}) {
  const headers = req.headers || {};
  const origin = String(headers.origin || "").trim();
  if (origin) return "web";
  const userAgent = String(headers["user-agent"] || "").trim();
  if (userAgent && BROWSER_USER_AGENT.test(userAgent)) return "web";
  return "mobile";
}

// IPv4-mapped IPv6 (::ffff:127.0.0.1) -> 127.0.0.1 cho dễ đọc trong log.
function normalizeIp(value) {
  const ip = String(value || "").trim();
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

function createClientContextMiddleware(options = {}) {
  const resolvePlatform = options.resolvePlatform || resolveClientPlatform;

  return function clientContextMiddleware(req, _res, next) {
    // Loại bỏ header giả mạo ngay trên request để không thể lọt xuống hạ tầng.
    for (const header of CLIENT_HEADERS_TO_STRIP) {
      if (req.headers) delete req.headers[header];
    }
    req.clientPlatform = resolvePlatform(req);
    // IP thật của socket: không tin x-forwarded-for do client tự gửi.
    req.clientIp = normalizeIp(req.socket && req.socket.remoteAddress);
    return next();
  };
}

module.exports = {
  createClientContextMiddleware,
  resolveClientPlatform,
  normalizeIp,
  CLIENT_HEADERS_TO_STRIP,
};
