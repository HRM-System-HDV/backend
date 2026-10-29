"use strict";

const express = require("express");
const SoapController = require("../controllers/SoapController");

const router = express.Router();

// GET /soap/payroll?wsdl — trả WSDL (chấp nhận ?wsdl / ?WSDL / ?WSDL=1)
router.get("/", (req, res, next) => {
  if (req.query && Object.keys(req.query).some((k) => k.toLowerCase() === "wsdl")) {
    return SoapController.sendWsdl(req, res);
  }
  return res.status(400).set("Content-Type", "text/xml; charset=utf-8").send(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soap:Body><soap:Fault><faultcode>soap:Client</faultcode>` +
      `<faultstring>Thiếu tham số ?wsdl</faultstring>` +
      `</soap:Fault></soap:Body></soap:Envelope>`
  );
});

// POST /soap/payroll — nhận PayoutRequest XML, trả PayoutResponse XML
router.post("/", SoapController.handlePayout);

module.exports = router;
