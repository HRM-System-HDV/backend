"use strict";

const SoapService = require("../services/SoapService");
const PayrollClient = require("../clients/PayrollClient");

function sendWsdl(_req, res) {
  const wsdl = SoapService.buildWsdl("http://localhost:4005/soap/payroll");
  res.status(200).set("Content-Type", "text/xml; charset=utf-8").send(wsdl);
}

function sendFault(res, message, httpStatus) {
  return res
    .status(httpStatus || 500)
    .set("Content-Type", "text/xml; charset=utf-8")
    .send(SoapService.buildSoapFault(message));
}

async function handlePayout(req, res) {
  const raw = typeof req.body === "string" ? req.body : "";
  if (!raw.trim()) {
    return sendFault(res, "Nội dung SOAP trống", 400);
  }
  const parsed = SoapService.parsePayoutRequest(raw);
  if (parsed.error) {
    return sendFault(res, parsed.error, 400);
  }
  let result;
  try {
    result = await PayrollClient.createPayout(parsed.data);
  } catch (e) {
    console.warn("[integration-service] Gọi payroll-service thất bại:", e.message);
    return sendFault(res, "Không kết nối được dịch vụ chi lương", 502);
  }
  const body = result.body || {};
  if (result.status === 422 || body.error?.code === "INSUFFICIENT_FUNDS") {
    return sendFault(res, "Số dư không đủ", 500);
  }
  if (result.status >= 400 || body.error) {
    return sendFault(res, body.error?.message || "Tạo lệnh chi thất bại", 500);
  }
  const payout = body.data || {};
  return res
    .status(200)
    .set("Content-Type", "text/xml; charset=utf-8")
    .send(
      SoapService.buildPayoutResponse({
        transactionId: payout.id,
        bankReference: payout.bankReference,
        status: payout.status || "success",
      })
    );
}

module.exports = { sendWsdl, handlePayout };
