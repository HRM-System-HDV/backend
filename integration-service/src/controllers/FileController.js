"use strict";

const FileService = require("../services/FileService");
const storage = require("../utils/localStorage");

function publicIdOf(req) {
  return req.params[0] || "";
}

async function getFile(req, res, next) {
  try {
    const { asset, bytes } = await FileService.getByPublicId(publicIdOf(req));
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Content-Length", bytes);
    res.setHeader("Cache-Control", "private, max-age=86400");
    const stream = storage.readStream(asset.storagePath);
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

async function deleteFile(req, res, next) {
  try {
    const result = await FileService.deleteByPublicId(publicIdOf(req));
    if (!result.deleted) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Không tìm thấy tệp" },
      });
    }
    return res.status(200).json({ data: { deleted: true }, message: "Đã xóa tệp" });
  } catch (err) {
    next(err);
  }
}

async function scanOrphans(req, res, next) {
  try {
    const result = await FileService.scanOrphans(req.body?.graceHours ?? 24);
    return res.status(200).json({ data: result, message: "Quét ảnh mồ côi thành công" });
  } catch (err) {
    next(err);
  }
}

async function purgeOrphans(req, res, next) {
  try {
    const result = await FileService.purgeOrphans(req.body?.publicIds);
    return res.status(200).json({ data: result, message: "Đã dọn ảnh mồ côi" });
  } catch (err) {
    next(err);
  }
}

module.exports = { getFile, deleteFile, scanOrphans, purgeOrphans };