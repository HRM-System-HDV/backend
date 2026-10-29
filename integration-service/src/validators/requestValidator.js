"use strict";

const VALID_TYPES = ["leave", "overtime", "advance", "shift_swap", "work_supplement", "other"];
const VALID_STATUSES = ["pending", "approved", "rejected"];

function validateCreateRequest(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Payload yêu cầu không hợp lệ"];
  }
  if (!payload.type || !VALID_TYPES.includes(payload.type)) {
    errors.push(`Loại yêu cầu không hợp lệ. Cho phép: ${VALID_TYPES.join(", ")}`);
  }
  if (!payload.employeeId || typeof payload.employeeId !== "string" || !payload.employeeId.trim()) {
    errors.push("Mã nhân viên (employeeId) là bắt buộc");
  }
  if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
    errors.push("Tiêu đề yêu cầu là bắt buộc");
  }
  if (!payload.content || typeof payload.content !== "string" || !payload.content.trim()) {
    errors.push("Nội dung yêu cầu là bắt buộc");
  }
  if (payload.type === "shift_swap") {
    if (!payload.sourceShiftId || !payload.targetShiftId) {
      errors.push("Đổi ca yêu cầu sourceShiftId và targetShiftId");
    }
  }
  return errors;
}

function canDeleteRequest(status) {
  return status === "pending";
}

module.exports = {
  VALID_TYPES,
  VALID_STATUSES,
  validateCreateRequest,
  canDeleteRequest,
};
