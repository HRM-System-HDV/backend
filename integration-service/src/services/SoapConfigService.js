"use strict";

const database = require("../config/database");

let memoryConfig = {
  id: "default",
  endpointUrl: "https://hrm.company.local/soap/payroll",
  wsdlUrl: "https://hrm.company.local/soap/payroll?wsdl",
  serviceName: "PayrollDirectDisbursementService",
  port: 8443,
  securityMode: "TransportWithMessageCredential (mTLS + X.509)",
  allowedIPs: [],
  status: "unknown",
  lastPingTime: null,
  avgResponseTime: null,
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
  for (const k of ["endpointUrl", "wsdlUrl", "serviceName", "port", "securityMode", "allowedIPs", "status", "lastPingTime", "avgResponseTime"]) {
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

module.exports = { getConfig, updateConfig };
