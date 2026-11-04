"use strict";

const database = require("../config/database");

let memoryConfig = {
  id: "default",
  endpointUrl: "https://hrm.company.local/soap/payroll",
  wsdlUrl: "https://hrm.company.local/soap/payroll?wsdl",
  serviceName: "PayrollDirectDisbursementService",
  port: 8443,
  securityMode: "TransportWithMessageCredential (mTLS + X.509)",
  allowedIPs: ["203.162.10.45", "118.70.124.8", "123.30.55.19", "14.161.32.90"],
  status: "healthy",
  lastPingTime: new Date().toLocaleString("vi-VN"),
  avgResponseTime: "128ms",
  certExpiry: "31/12/2026",
  channel: "Gateway (SOAP 1.2 / HTTPS)",
};

async function getConfig() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.soapGatewayConfig.findUnique({ where: { id: "default" } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryConfig;
}

async function updateConfig(payload) {
  const allowed = {};
  for (const k of [
    "endpointUrl",
    "wsdlUrl",
    "serviceName",
    "port",
    "securityMode",
    "allowedIPs",
    "status",
    "lastPingTime",
    "avgResponseTime",
    "certExpiry",
    "channel",
  ]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.soapGatewayConfig.upsert({
        where: { id: "default" },
        update: allowed,
        create: { ...memoryConfig, ...allowed },
      });
    } catch (_) {}
  }
  memoryConfig = { ...memoryConfig, ...allowed };
  return memoryConfig;
}

async function pingGateway() {
  const startTime = Date.now();
  // Giả lập ping nội bộ gateway /soap/payroll?wsdl
  const nowStr = new Date().toLocaleString("vi-VN");
  const elapsed = `${Math.floor(Math.random() * 20 + 35)}ms`;
  const updated = await updateConfig({
    status: "healthy",
    lastPingTime: nowStr,
    avgResponseTime: elapsed,
  });
  return {
    status: "healthy",
    responseTime: elapsed,
    pingTime: nowStr,
    config: updated,
  };
}

module.exports = { getConfig, updateConfig, pingGateway };
