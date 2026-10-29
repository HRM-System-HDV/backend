"use strict";

const RequestService = require("../services/RequestService");
const { validateCreateRequest, canDeleteRequest } = require("../validators/requestValidator");
const errorCodes = require("../utils/errors");

async function listRequests(req, res, next) {
  try {
    const rows = await RequestService.findMany(req.query);
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
    const created = await RequestService.create({
      type: req.body.type,
      employeeId: req.body.employeeId,
      branchSlug: req.body.branchSlug,
      title: req.body.title.trim(),
      content: req.body.content.trim(),
      attachmentUrl: req.body.attachmentUrl,
      sourceShiftId: req.body.sourceShiftId,
      targetShiftId: req.body.targetShiftId,
    });
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
  deleteRequest,
};
