"use strict";

// Tuyến SOAP phải trả XML, không bọc envelope JSON (RULES.md §5.3, A_Work_Flow §5).
// Lỗi ở tuyến /soap/* trả về <soap:Fault> với faultcode soap:Client (lỗi phía
// client, 4xx) hoặc soap:Server (lỗi hệ thống, 5xx), giữ nguyên status code.
const SOAP_FAULT_CONTENT_TYPE = "text/xml; charset=utf-8";

function isSoapPath(req = {}) {
  const path = String(req.path || req.url || "");
  return path.startsWith("/soap/");
}

function escapeXml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSoapFault(status, code, message) {
  const faultCode = status >= 500 ? "soap:Server" : "soap:Client";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    "  <soap:Body>",
    "    <soap:Fault>",
    `      <faultcode>${faultCode}</faultcode>`,
    `      <faultstring>${escapeXml(message)}</faultstring>`,
    `      <detail>${escapeXml(code)}</detail>`,
    "    </soap:Fault>",
    "  </soap:Body>",
    "</soap:Envelope>",
  ].join("\n");
}

/**
 * Trả lỗi theo đúng khuôn của tuyến: /soap/* -> XML soap:Fault, còn lại ->
 * envelope JSON { error: { code, message } } (RULES.md §5.2).
 */
function sendError(req, res, status, code, message) {
  if (isSoapPath(req)) {
    res.status(status);
    if (typeof res.set === "function") res.set("Content-Type", SOAP_FAULT_CONTENT_TYPE);
    else if (typeof res.setHeader === "function") res.setHeader("Content-Type", SOAP_FAULT_CONTENT_TYPE);
    return res.send(buildSoapFault(status, code, message));
  }
  return res.status(status).json({ error: { code, message } });
}

module.exports = { isSoapPath, buildSoapFault, sendError, escapeXml, SOAP_FAULT_CONTENT_TYPE };
