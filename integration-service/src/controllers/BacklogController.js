"use strict";

const BacklogService = require("../services/BacklogService");

async function listBacklogs(req, res, next) {
  try {
    const rows = await BacklogService.list(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (err) {
    return next(err);
  }
}

async function createBacklog(req, res, next) {
  try {
    const row = await BacklogService.create(req.body);
    return res.status(201).json({ data: row, message: "Ghi nhật ký thành công" });
  } catch (err) {
    return next(err);
  }
}

async function clearBacklogs(_req, res, next) {
  try {
    await BacklogService.clear();
    return res.status(200).json({ data: { ok: true }, message: "Đã xóa toàn bộ nhật ký backlog" });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listBacklogs,
  createBacklog,
  clearBacklogs,
};

