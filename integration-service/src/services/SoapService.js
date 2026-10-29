"use strict";

// Logic SOAP thuần túy (không phụ thuộc Express) để dễ kiểm thử unit.
// Khuôn SSOT tại A_Work_Flow.md §6:
// Request: PayoutRequest(idempotencyKey, debitAccount, content, totalAmount, beneficiaryCount)
// Response: PayoutResponse(transactionId TXN-*, bankReference BANK-*, status)
// Lỗi: soap:Fault với faultcode = soap:Client.

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value) {
  return String(value ?? "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function extractTag(xml, tag) {
  const re = new RegExp(`<\\s*(?:\\w+:)?${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*(?:\\w+:)?${tag}\\s*>`, "i");
  const m = re.exec(xml);
  return m ? unescapeXml(m[1].trim()) : "";
}

function parsePayoutRequest(xml) {
  const body = String(xml || "");
  if (!/<\s*(?:\w+:)?Body[\s>]/i.test(body) || !/<\s*(?:\w+:)?PayoutRequest[\s>]/i.test(body)) {
    return { error: "Nội dung SOAP không hợp lệ, thiếu PayoutRequest" };
  }
  const idempotencyKey = extractTag(body, "idempotencyKey");
  const debitAccount = extractTag(body, "debitAccount");
  const content = extractTag(body, "content");
  const totalAmountRaw = extractTag(body, "totalAmount");
  const beneficiaryCountRaw = extractTag(body, "beneficiaryCount");
  const missing = [];
  if (!idempotencyKey) missing.push("idempotencyKey");
  if (!debitAccount) missing.push("debitAccount");
  if (!totalAmountRaw) missing.push("totalAmount");
  if (missing.length) return { error: `Thiếu trường bắt buộc: ${missing.join(", ")}` };
  const totalAmount = Number(totalAmountRaw);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { error: "Tổng tiền chi phải lớn hơn 0" };
  }
  return {
    data: {
      idempotencyKey,
      debitAccount,
      content,
      totalAmount,
      beneficiaryCount: beneficiaryCountRaw ? Number(beneficiaryCountRaw) || 0 : 0,
    },
  };
}

function buildPayoutResponse({ transactionId, bankReference, status }) {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><PayoutResponse>` +
    `<transactionId>${escapeXml(transactionId)}</transactionId>` +
    `<bankReference>${escapeXml(bankReference)}</bankReference>` +
    `<status>${escapeXml(status || "success")}</status>` +
    `</PayoutResponse></soap:Body></soap:Envelope>`;
}

function buildSoapFault(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><soap:Fault>` +
    `<faultcode>soap:Client</faultcode>` +
    `<faultstring>${escapeXml(message || "Lỗi hệ thống")}</faultstring>` +
    `</soap:Fault></soap:Body></soap:Envelope>`;
}

function buildWsdl(serviceUrl) {
  const base = serviceUrl || "http://localhost:4005/soap/payroll";
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<definitions name="PayrollService" targetNamespace="http://hrm.company.com/payroll"` +
    ` xmlns="http://schemas.xmlsoap.org/wsdl/"` +
    ` xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"` +
    ` xmlns:tns="http://hrm.company.com/payroll"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<types><xsd:schema targetNamespace="http://hrm.company.com/payroll">` +
    `<xsd:element name="PayoutRequest"><xsd:complexType><xsd:sequence>` +
    `<xsd:element name="idempotencyKey" type="xsd:string"/>` +
    `<xsd:element name="debitAccount" type="xsd:string"/>` +
    `<xsd:element name="content" type="xsd:string"/>` +
    `<xsd:element name="totalAmount" type="xsd:decimal"/>` +
    `<xsd:element name="beneficiaryCount" type="xsd:int"/>` +
    `</xsd:sequence></xsd:complexType></xsd:element>` +
    `<xsd:element name="PayoutResponse"><xsd:complexType><xsd:sequence>` +
    `<xsd:element name="transactionId" type="xsd:string"/>` +
    `<xsd:element name="bankReference" type="xsd:string"/>` +
    `<xsd:element name="status" type="xsd:string"/>` +
    `</xsd:sequence></xsd:complexType></xsd:element>` +
    `</xsd:schema></types>` +
    `<message name="PayoutRequestMessage"><part name="parameters" element="tns:PayoutRequest"/></message>` +
    `<message name="PayoutResponseMessage"><part name="parameters" element="tns:PayoutResponse"/></message>` +
    `<portType name="PayrollPortType"><operation name="CreatePayout">` +
    `<input message="tns:PayoutRequestMessage"/><output message="tns:PayoutResponseMessage"/>` +
    `</operation></portType>` +
    `<binding name="PayrollBinding" type="tns:PayrollPortType">` +
    `<soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>` +
    `<operation name="CreatePayout"><soap:operation soapAction="CreatePayout"/>` +
    `<input><soap:body use="literal"/></input><output><soap:body use="literal"/></output>` +
    `</operation></binding>` +
    `<service name="PayrollService"><port name="PayrollPort" binding="tns:PayrollBinding">` +
    `<soap:address location="${escapeXml(base)}"/>` +
    `</port></service></definitions>`;
}

module.exports = {
  escapeXml,
  parsePayoutRequest,
  buildPayoutResponse,
  buildSoapFault,
  buildWsdl,
};
