"use strict";

const WifiConfigService = require("../services/WifiConfigService");
const { validateCreateWifiConfig } = require("../validators/wifiConfigValidator");
const errorCodes = require("../utils/errors");

async function getAllWifiConfigs(req, res, next) {
  try {
    const { branch } = req.query;
    const list = await WifiConfigService.findMany({ branch });
    return res.status(200).json({ data: list });
  } catch (error) {
    next(error);
  }
}

async function getWifiConfigById(req, res, next) {
  try {
    const { id } = req.params;
    const item = await WifiConfigService.findById(id);
    if (!item) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy cấu hình Wi-Fi" },
      });
    }
    return res.status(200).json({ data: item });
  } catch (error) {
    next(error);
  }
}

async function createWifiConfig(req, res, next) {
  try {
    const errors = validateCreateWifiConfig(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: errors.join(", ") },
      });
    }

    const created = await WifiConfigService.create({
      ssid: req.body.ssid.trim(),
      bssid: req.body.bssid.trim(),
      branch: req.body.branch.trim(),
      status: req.body.status || "hoạt động",
    });

    return res.status(201).json({
      data: created,
      message: "Tạo cấu hình Wi-Fi thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function updateWifiConfig(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await WifiConfigService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy cấu hình Wi-Fi để cập nhật" },
      });
    }

    const updated = await WifiConfigService.update(id, req.body);
    return res.status(200).json({
      data: updated,
      message: "Cập nhật cấu hình Wi-Fi thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function deleteWifiConfig(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await WifiConfigService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy cấu hình Wi-Fi để xóa" },
      });
    }

    await WifiConfigService.deleteById(id);
    return res.status(200).json({
      data: { id, deleted: true },
      message: "Xóa cấu hình Wi-Fi thành công",
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllWifiConfigs,
  getWifiConfigById,
  createWifiConfig,
  updateWifiConfig,
  deleteWifiConfig,
};
