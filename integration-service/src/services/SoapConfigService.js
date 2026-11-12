"use strict";

const database = require("../config/database");
const config = require("../config");
const { toVnDate, toVnDateTime } = require("../utils/dateFormat");

function nowVn() {
  return toVnDateTime(new Date());
}

let memoryConfig = {
  id: "default",
  endpointUrl: "https://hrm.company.local/soap/payroll",
  wsdlUrl: "https://hrm.company.local/soap/payroll?wsdl",
  serviceName: "PayrollDirectDisbursementService",
  port: 8443,
  securityMode: "TransportWithMessageCredential (mTLS + X.509)",
  // Không bịa danh sách IP: danh sách này phải do quản trị viên cấu hình.
  allowedIPs: [],
  // Ba trường dưới đây là KẾT QUẢ đo, không phải thuộc tính cấu hình: để "unknown"/null
  // vì chưa có lần ping nào. Bộ mặc định cũ ("healthy", "128ms") làm màn hình Ngân hàng
  // hiển thị độ khoẻ bịa khi CSDL chưa có dòng.
  status: "unknown",
  lastPingTime: null,
  avgResponseTime: null,
  certExpiry: null,
  channel: "Gateway (SOAP 1.2 / HTTPS)",
};

async function getConfig() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.soapGatewayConfig.findUnique({ where: { id: "default" } });
      if (row) return row;
    } catch (err) {
      // Có Prisma mà đọc lỗi thì phải nổ lỗi: trả về cấu hình trong bộ nhớ sẽ
      // khiến màn hình hiển thị cấu hình giả như thật.
      console.error("[integration-service] Lỗi đọc cấu hình SOAP:", err.message);
      const error = new Error("Không đọc được cấu hình SOAP từ CSDL");
      error.status = 500;
      error.code = "INTERNAL_SERVER_ERROR";
      throw error;
    }
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
  if (allowed.certExpiry) allowed.certExpiry = toVnDate(allowed.certExpiry) || allowed.certExpiry;
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.soapGatewayConfig.upsert({
        where: { id: "default" },
        update: allowed,
        create: { ...memoryConfig, ...allowed },
      });
    } catch (err) {
      // Ghi hỏng thì phải nổ lỗi, không ghi vào bộ nhớ rồi báo thành công.
      console.error("[integration-service] Lỗi lưu cấu hình SOAP:", err.message);
      const error = new Error("Không lưu được cấu hình SOAP vào CSDL");
      error.status = 500;
      error.code = "INTERNAL_SERVER_ERROR";
      throw error;
    }
  }
  memoryConfig = { ...memoryConfig, ...allowed };
  return memoryConfig;
}

// Ping THẬT: gọi HTTP tới wsdlUrl (hoặc endpointUrl) đã cấu hình và đo thời gian phản hồi.
// Trả về 4 trạng thái theo đúng những gì đo được:
//   unknown  – chưa cấu hình mục tiêu
//   healthy  – HTTP 2xx/3xx
//   degraded – endpoint trả lời nhưng HTTP >= 400
//   down     – không nối được / quá timeout
async function pingGateway() {
  const cfg = await getConfig();
  const pingTime = nowVn();
  const target = cfg.wsdlUrl || cfg.endpointUrl || "";

  if (!target) {
    const updated = await updateConfig({ status: "unknown", lastPingTime: pingTime, avgResponseTime: null });
    return {
      status: "unknown",
      responseTime: null,
      pingTime,
      endpoint: null,
      error: "Chưa cấu hình wsdlUrl/endpointUrl để kiểm tra",
      config: updated,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  let status = "down";
  let httpStatus = null;
  let error = null;
  try {
    const res = await fetch(target, { method: "GET", signal: controller.signal });
    httpStatus = res.status;
    if (res.ok) {
      status = "healthy";
    } else {
      status = "degraded";
      error = `Endpoint trả HTTP ${res.status}`;
    }
  } catch (e) {
    status = "down";
    error = e.name === "AbortError" ? `Vượt quá thời gian chờ ${config.timeoutMs}ms` : e.message;
  } finally {
    clearTimeout(timeoutId);
  }

  const responseTime = `${Date.now() - startedAt}ms`;
  const updated = await updateConfig({ status, lastPingTime: pingTime, avgResponseTime: responseTime });
  return { status, responseTime, pingTime, endpoint: target, httpStatus, error, config: updated };
}

module.exports = { getConfig, updateConfig, pingGateway };
