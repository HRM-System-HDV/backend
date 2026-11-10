"use strict";

const ArchiveService = require("../services/ArchiveService");

async function preview(req, res, next) {
  try {
    const data = await ArchiveService.preview(req.body || {});
    return res.status(200).json({ data, message: "Xem trước số lượng bản ghi lưu trữ thành công" });
  } catch (err) {
    next(err);
  }
}

async function run(req, res, next) {
  try {
    const data = await ArchiveService.run(req.body || {});
    return res.status(200).json({ data, message: "Đã chuyển bản ghi vào kho lưu trữ" });
  } catch (err) {
    next(err);
  }
}

function listHandler(type) {
  return async (req, res, next) => {
    try {
      const data = await ArchiveService.list(type, req.query || {});
      return res.status(200).json({ data, message: "Tải danh sách lưu trữ thành công" });
    } catch (err) {
      next(err);
    }
  };
}

function detailHandler(type) {
  return async (req, res, next) => {
    try {
      const data = await ArchiveService.detail(type, req.params.id);
      return res.status(200).json({ data, message: "Tải chi tiết bản ghi lưu trữ thành công" });
    } catch (err) {
      next(err);
    }
  };
}

function restoreHandler(type) {
  return async (req, res, next) => {
    try {
      const data = await ArchiveService.restore(type, req.params.id);
      return res.status(200).json({ data, message: "Đã khôi phục bản ghi về danh sách hoạt động" });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { preview, run, listHandler, detailHandler, restoreHandler };