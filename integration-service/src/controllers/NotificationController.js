"use strict";

const NotificationService = require("../services/NotificationService");
const { validateCreateNotification } = require("../validators/notificationValidator");
const errorCodes = require("../utils/errors");
const { toVnDate } = require("../utils/dateFormat");
const { writeBranchSlug } = require("../utils/branchScope");

function normalizeShiftDate(value) {
  if (!value) return null;
  return toVnDate(value) || String(value).trim();
}

// metadata là JSON tự do nhưng các khóa ngày ca vẫn phải đúng chuẩn DD/MM/YYYY.
function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata || null;
  const next = { ...metadata };
  for (const key of ["shiftDate", "swapShiftDate"]) {
    if (typeof next[key] === "string" && next[key].trim()) {
      next[key] = normalizeShiftDate(next[key]);
    }
  }
  return next;
}

// branchSlug chỉ là bộ lọc xem chéo dành cho admin. Manager buộc dùng chi nhánh
// do gateway gắn trên header, client không được tự chọn.
// Admin KHÔNG có chi nhánh trong mô hình 3 vai trò: nếu tài khoản admin còn sót
// branchSlug (do dữ liệu cũ để lại) thì header đó không được phép giam admin
// vào một chi nhánh — admin chỉ lọc khi hỏi tường minh bằng ?branchSlug=.
function scopeBranchSlug(req) {
  const role = req.headers["x-user-role"];
  if (role === "admin") return req.query.branchSlug || null;
  return req.headers["x-branch-slug"] || null;
}

// Nhân viên chỉ được xem phạm vi của chính mình, kể cả khi client gửi employeeId
// của người khác. Quản lý/admin giữ quyền xem theo chi nhánh.
function notificationScope(req) {
  const role = req.headers["x-user-role"];
  const userId = req.headers["x-user-id"];
  if (userId && role !== "admin" && role !== "manager") {
    return { employeeId: userId, branchSlug: null };
  }
  const branchSlug = scopeBranchSlug(req);
  return {
    employeeId: req.query.employeeId || userId || null,
    branchSlug,
    // Admin không chọn chi nhánh thì xem chéo toàn hệ thống, nên phải thấy cả
    // thông báo phạm vi chi nhánh (manager chỉ thấy đúng chi nhánh của mình).
    allBranches: role === "admin" && !branchSlug,
  };
}

// Bản ghi có nằm trong đúng phạm vi mà listNotifications đang hiển thị cho người gọi?
function canAccessNotification(req, row) {
  return NotificationService.matchesVisibility(row, notificationScope(req));
}

function forbiddenAccess(res) {
  return res.status(403).json({
    error: { code: errorCodes.FORBIDDEN, message: "Bạn không có quyền thao tác với thông báo này" },
  });
}

async function listNotifications(req, res, next) {
  try {
    const rows = await NotificationService.findMany(notificationScope(req));
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (error) {
    return next(error);
  }
}

async function getSettings(req, res, next) {
  try {
    const userId = req.headers["x-user-id"] || req.query.userId || "default";
    const settings = await NotificationService.getSettings(userId);
    return res.status(200).json({ data: settings, message: "Thao tác thành công" });
  } catch (error) {
    return next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    const userId = req.headers["x-user-id"] || req.query.userId || "default";
    const updated = await NotificationService.updateSettings(userId, req.body || {});
    return res.status(200).json({ data: updated, message: "Cập nhật cài đặt thông báo thành công" });
  } catch (error) {
    return next(error);
  }
}

async function createNotification(req, res, next) {
  try {
    const errors = validateCreateNotification(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: errors.join("; ") },
      });
    }
    const created = await NotificationService.create({
      targetEmployeeId: req.body.targetEmployeeId || null,
      branchSlug: writeBranchSlug(req, req.body.branchSlug),
      title: req.body.title.trim(),
      body: req.body.body.trim(),
      metadata: normalizeMetadata(req.body.metadata),
      requestType: req.body.requestType || null,
      shiftName: req.body.shiftName || null,
      shiftDate: normalizeShiftDate(req.body.shiftDate),
      shiftTime: req.body.shiftTime || null,
      shiftHours: req.body.shiftHours || null,
      senderName: req.body.senderName || null,
      senderRole: req.body.senderRole || null,
      senderPhone: req.body.senderPhone || null,
    });
    return res.status(201).json({ data: created, message: "Gửi thông báo thành công" });
  } catch (error) {
    return next(error);
  }
}

async function markAsRead(req, res, next) {
  try {
    // Đọc phải kiểm tra chủ sở hữu TRƯỚC khi ghi, nếu không ai cũng đánh dấu đã đọc
    // thông báo của người khác theo id tuần tự.
    const existing = await NotificationService.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy thông báo" },
      });
    }
    if (!canAccessNotification(req, existing)) {
      return forbiddenAccess(res);
    }
    const row = await NotificationService.markAsRead(req.params.id);
    if (!row) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy thông báo" },
      });
    }
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (error) {
    return next(error);
  }
}

async function markAllAsRead(req, res, next) {
  try {
    const { employeeId, branchSlug } = notificationScope(req);
    const result = await NotificationService.markAllAsRead({ employeeId, branchSlug });
    return res.status(200).json({
      data: result,
      message: "Đã đánh dấu tất cả thông báo là đã đọc",
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteNotification(req, res, next) {
  try {
    const existing = await NotificationService.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy thông báo" },
      });
    }
    if (!canAccessNotification(req, existing)) {
      return forbiddenAccess(res);
    }
    await NotificationService.deleteById(req.params.id);
    return res.status(200).json({ data: { ok: true }, message: "Xóa thông báo thành công" });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getSettings,
  updateSettings,
};
