"use strict";

const ArchiveService = require("../services/ArchiveService");

async function run(req, res, next) {
  try {
    const data = await ArchiveService.run(req.body || {});
    return res.status(200).json({ data, message: "Đã chuyển bản ghi vào kho lưu trữ" });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const data = await ArchiveService.list(req.query || {});
    return res.status(200).json({ data, message: "Tải danh sách lưu trữ thành công" });
  } catch (err) {
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const data = await ArchiveService.detail(req.params.id);
    return res.status(200).json({ data, message: "Tải chi tiết bản ghi lưu trữ thành công" });
  } catch (err) {
    next(err);
  }
}

async function restore(req, res, next) {
  try {
    const data = await ArchiveService.restore(req.params.id);
    return res.status(200).json({ data, message: "Đã khôi phục bản ghi về danh sách hoạt động" });
  } catch (err) {
    next(err);
  }
}

module.exports = { run, list, detail, restore };