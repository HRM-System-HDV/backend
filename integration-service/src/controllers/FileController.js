"use strict";

const FileService = require("../services/FileService");
const storage = require("../utils/localStorage");
const {admin} = require("../utils/access");

function publicIdOf(req) {
  return req.params[0] || "";
}

// Đọc ảnh (CCCD, avatar) là dữ liệu nhạy cảm: chỉ chủ file, admin hoặc quản lý
// cùng chi nhánh được xem. File không có chi nhánh (đã tải lên trước khi có
// chi nhánh) chỉ admin và chủ file xem được.
function assertCanReadFile(req, asset) {
  const role = req.headers["x-user-role"];
  const userId = req.headers["x-user-id"];
  if (role === "admin") return;
  if (userId && asset.uploadedBy && String(asset.uploadedBy) === String(userId)) return;
  if (role === "manager") {
    const own = String(req.headers["x-branch-id"] || "");
    const target = String(asset.branchId || "");
    if (own && target && own === target) return;
  }
  const err = new Error("Bạn không có quyền xem tệp này");
  err.status = 403;
  err.code = "FORBIDDEN";
  throw err;
}

async function getFile(req, res, next) {
  try {
    const { asset, bytes } = await FileService.getByPublicId(publicIdOf(req));
    if(asset.regulationId) await require("../services/IntegrationService").contentGet("regulation",asset.regulationId,req.actor);
    else if(!(asset.folder === "hrm/tasks" && req.actor.branchId && req.actor.branchId === asset.branchId)) assertCanReadFile(req, asset);
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
    if(!req.actor.internal) admin(req.actor);
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

module.exports = { getFile, deleteFile };
