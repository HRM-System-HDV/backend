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
    // Nhật ký phải ghi danh tính gateway đã verify, không tin userName/userRole
    // client tự gửi — nếu không nhân viên có thể mạo danh admin trong log.
    const row = await BacklogService.create({
      ...req.body,
      userName: req.headers["x-user-email"] || req.body.userName,
      userRole: req.headers["x-user-role"] || req.body.userRole,
    });
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

