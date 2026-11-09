"use strict";

const RequestService = require("../services/RequestService");
const { validateCreateRequest, canDeleteRequest } = require("../validators/requestValidator");
const errorCodes = require("../utils/errors");

// Nhân viên chỉ thấy đơn của chính mình dù client gửi employeeId khác.
// Quản lý/admin xem theo chi nhánh hoặc toàn hệ thống.
function requestScope(req) {
  const role = req.headers["x-user-role"];
  const userId = req.headers["x-user-id"];
  const privileged = role === "admin" || role === "manager";
  if (userId && !privileged) {
    return { ...req.query, employeeId: userId, branchSlug: null };
  }
  return {
    ...req.query,
    employeeId: req.query.employeeId || (privileged ? null : userId) || null,
    branchSlug: req.query.branchSlug || req.headers["x-branch-slug"] || null,
  };
}

function callerId(req) {
  return req.headers["x-user-id"] || null;
}

function isPrivileged(req) {
  const role = req.headers["x-user-role"];
  return role === "admin" || role === "manager";
}

async function listRequests(req, res, next) {
  try {
    const rows = await RequestService.findMany(requestScope(req));
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (error) {
    return next(error);
  }
}

async function getRequestById(req, res, next) {
  try {
    const row = await RequestService.findById(req.params.id);
    if (!row) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy yêu cầu" },
      });
    }
    const uid = callerId(req);
    if (uid && !isPrivileged(req) && row.employeeId !== uid) {
      return res.status(403).json({
        error: { code: errorCodes.FORBIDDEN, message: "Bạn không có quyền xem yêu cầu này" },
      });
    }
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (error) {
    return next(error);
  }
}

async function createRequest(req, res, next) {
  try {
    const errors = validateCreateRequest(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: errors.join("; ") },
      });
    }
    const uid = callerId(req);
    if (uid && !isPrivileged(req) && req.body.employeeId && req.body.employeeId !== uid) {
      return res.status(403).json({
        error: { code: errorCodes.FORBIDDEN, message: "Không được tạo yêu cầu cho nhân viên khác" },
      });
    }
    const created = await RequestService.create(
      {
        type: req.body.type,
        employeeId: req.body.employeeId || uid,
        targetEmployeeId: req.body.targetEmployeeId || null,
        branchSlug: req.body.branchSlug,
        title: req.body.title.trim(),
        content: req.body.content.trim(),
        attachmentUrl: req.body.attachmentUrl,
        sourceShiftId: req.body.sourceShiftId,
        targetShiftId: req.body.targetShiftId,
      },
      req.body.notification,
    );
    return res.status(201).json({ data: created, message: "Tạo yêu cầu thành công" });
  } catch (error) {
    return next(error);
  }
}

async function reviewRequest(req, res, approved) {
  try {
    const updated = approved
      ? await RequestService.approveRequest(req.params.id, {
          reviewedBy: req.body.reviewedBy,
          reviewNote: req.body.reviewNote,
        })
      : await RequestService.rejectRequest(req.params.id, {
          reviewedBy: req.body.reviewedBy,
          reviewNote: req.body.reviewNote,
        });
    return res.status(200).json({
      data: updated,
      message: approved ? "Duyệt yêu cầu thành công" : "Từ chối yêu cầu thành công",
    });
  } catch (e) {
    if (e.status === 404 || e.status === 400) {
      return res.status(e.status).json({
        error: { code: e.code, message: e.message },
      });
    }
    throw e;
  }
}

async function approveRequest(req, res, next) {
  try {
    return await reviewRequest(req, res, true);
  } catch (error) {
    return next(error);
  }
}

async function rejectRequest(req, res, next) {
  try {
    return await reviewRequest(req, res, false);
  } catch (error) {
    return next(error);
  }
}

// Đồng nghiệp được nhờ làm thay / đổi ca trả lời (không phải quản lý duyệt).
async function respondRequest(req, res, next) {
  try {
    const uid = callerId(req);
    if (!uid) {
      return res.status(403).json({
        error: { code: errorCodes.FORBIDDEN, message: "Thiếu danh tính người phản hồi" },
      });
    }
    const updated = await RequestService.respondRequest(req.params.id, req.body.accept === true, {
      responderId: uid,
    });
    return res.status(200).json({
      data: updated,
      message: req.body.accept === true ? "Đã chấp nhận yêu cầu" : "Đã từ chối yêu cầu",
    });
  } catch (e) {
    if (e.status === 400 || e.status === 403 || e.status === 404) {
      return res.status(e.status).json({ error: { code: e.code, message: e.message } });
    }
    return next(e);
  }
}

async function deleteRequest(req, res, next) {
  try {
    const row = await RequestService.findById(req.params.id);
    if (!row) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy yêu cầu" },
      });
    }
    if (!canDeleteRequest(row.status)) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: "Chỉ được xóa yêu cầu đang chờ xử lý" },
      });
    }
    await RequestService.deleteById(req.params.id);
    return res.status(200).json({ data: { ok: true }, message: "Xóa yêu cầu thành công" });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listRequests,
  getRequestById,
  createRequest,
  approveRequest,
  rejectRequest,
  respondRequest,
  deleteRequest,
};
