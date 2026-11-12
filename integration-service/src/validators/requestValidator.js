"use strict";

// 4 loại yêu cầu được hỗ trợ: nghỉ phép, tạm ứng, đổi ca, bổ sung công.
const VALID_TYPES = ["leave", "advance", "shift_swap", "work_supplement"];
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
  if (payload.targetEmployeeId !== undefined && payload.targetEmployeeId !== null) {
    if (typeof payload.targetEmployeeId !== "string" || !payload.targetEmployeeId.trim()) {
      errors.push("targetEmployeeId không hợp lệ");
    } else if (payload.targetEmployeeId === payload.employeeId) {
      errors.push("Không thể gửi yêu cầu cho chính mình");
    }
    if (payload.type !== "shift_swap") {
      errors.push("Chỉ đơn làm thay / đổi ca mới có nhân viên nhận yêu cầu");
    }
  }
  if (payload.notification !== undefined && payload.notification !== null
    && typeof payload.notification !== "object") {
    errors.push("notification không hợp lệ");
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
