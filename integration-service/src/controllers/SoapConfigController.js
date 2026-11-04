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

async function pingSoapGateway(_req, res, next) {
  try {
    const result = await SoapConfigService.pingGateway();
    return res.status(200).json({ data: result, message: "Kiểm tra kết nối thành công" });
  } catch (e) {
    return next(e);
  }
}

module.exports = { getSoapConfig, updateSoapConfig, pingSoapGateway };
