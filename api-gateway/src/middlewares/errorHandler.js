"use strict";

const { sendError } = require("../utils/soapFault");

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "Lỗi hệ thống";
  if (status >= 500) console.error(err);
  // Tuyến /soap/* trả soap:Fault (XML), các tuyến khác trả envelope JSON
  // { error: { code, message } } theo RULES.md §5.2.
  return sendError(req, res, status, code, message);
}

module.exports = { errorHandler };
