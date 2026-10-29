"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const SoapService = require("../../src/services/SoapService");

const ENVELOPE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><PayoutRequest>
<idempotencyKey>key-1</idempotencyKey>
<debitAccount>111000111</debitAccount>
<content>Lương T10</content>
<totalAmount>5000000</totalAmount>
<beneficiaryCount>2</beneficiaryCount>
</PayoutRequest></soap:Body></soap:Envelope>`;

test("parse PayoutRequest hợp lệ", () => {
  const r = SoapService.parsePayoutRequest(ENVELOPE);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.data, {
    idempotencyKey: "key-1",
    debitAccount: "111000111",
    content: "Lương T10",
    totalAmount: 5000000,
    beneficiaryCount: 2,
  });
});

test("thiếu trường bắt buộc trả lỗi tiếng Việt", () => {
  const r = SoapService.parsePayoutRequest("<soap:Envelope><soap:Body><PayoutRequest><content>x</content></PayoutRequest></soap:Body></soap:Envelope>");
  assert.ok(r.error.includes("idempotencyKey"));
});

test("build response + fault đúng khuôn", () => {
  const xml = SoapService.buildPayoutResponse({ transactionId: "TXN-1", bankReference: "BANK-1", status: "success" });
  assert.ok(xml.includes("<PayoutResponse>") && xml.includes("TXN-1"));
  const fault = SoapService.buildSoapFault("Số dư không đủ");
  assert.ok(fault.includes("<faultcode>soap:Client</faultcode>") && fault.includes("Số dư không đủ"));
});

test("WSDL chứa PayoutRequest/PayoutResponse", () => {
  const wsdl = SoapService.buildWsdl("http://localhost:4005/soap/payroll");
  assert.ok(wsdl.includes('name="PayoutRequest"') && wsdl.includes('name="PayoutResponse"'));
});
