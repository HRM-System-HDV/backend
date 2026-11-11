"use strict";

const SoapConfigService = require("../services/SoapConfigService");

async function getSoapConfig(_req, res, next) {
  try {
    const cfg = await SoapConfigService.getConfig();
    return res.status(200).json({ data: cfg, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateSoapConfig(req, res, next) {
  try {
    const cfg = await SoapConfigService.updateConfig(req.body || {});
    return res.status(200).json({ data: cfg, message: "Cập nhật cấu hình thành công" });
  } catch (e) {
    return next(e);
  }
}

const PING_MESSAGE = {
  healthy: "Kết nối SOAP khỏe",
  degraded: "Endpoint SOAP trả về lỗi HTTP",
  down: "Không kết nối được endpoint SOAP",
  unknown: "Chưa cấu hình endpoint SOAP để kiểm tra",
};

async function pingSoapGateway(_req, res, next) {
  try {
    const result = await SoapConfigService.pingGateway();
    // 200 dù endpoint chết: phép đo đã chạy thành công, trạng thái nằm trong data.status.
    // Trước đây mọi lần ping đều báo "thành công" vì dữ liệu là số bịa.
    return res.status(200).json({
      data: result,
      message: PING_MESSAGE[result.status] || "Không xác định được trạng thái kết nối SOAP",
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = { getSoapConfig, updateSoapConfig, pingSoapGateway };
