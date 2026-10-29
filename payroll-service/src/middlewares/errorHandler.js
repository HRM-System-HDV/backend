"use strict";

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "Lỗi hệ thống";
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
