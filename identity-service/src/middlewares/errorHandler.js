"use strict";

// Envelope lỗi chuẩn: { error: { code, message } }
function errorHandler(err, _req, res, _next) {
  const mappings = { P2002: [409, "DUPLICATE_RESOURCE", "Email hoặc hồ sơ nhân viên đã được sử dụng"], P2025: [404, "NOT_FOUND", "Không tìm thấy tài nguyên"] };
  const mapped = mappings[err.code];
  const status = mapped?.[0] || err.status || 500;
  const code = mapped?.[1] || (status >= 500 ? "INTERNAL_SERVER_ERROR" : err.code);
  const message = mapped?.[2] || (status >= 500 ? "Lỗi hệ thống" : err.message);
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
