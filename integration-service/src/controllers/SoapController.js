"use strict";

const SoapService = require("../services/SoapService");
const clients = require("../clients/ServiceClient");
const {actor,admin} = require("../utils/access");
const config = require("../config");

function sendWsdl(_req, res) {
  const wsdl = SoapService.buildWsdl(`${config.publicBaseUrl}/soap/payroll`);
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
    const who=actor(req);admin(who);
    result = await clients.payout(parsed.data,who);
  } catch (e) {
    return sendFault(res,e.message,e.status || 502);
  }
  const payout = result;
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
