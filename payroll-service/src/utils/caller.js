"use strict";

const { ForbiddenError } = require("./errors");

// Danh tính do gateway chuyển xuống sau khi verify JWT và xóa header giả mạo.
function callerFrom(req) {
  return {
    userId: req.headers["x-user-id"] || null,
    role: req.headers["x-user-role"] || "staff",
    branchSlug: req.headers["x-branch-slug"] || null,
  };
}

function isPrivileged(caller) {
  return caller.role === "admin" || caller.role === "manager";
}

// Nhân viên chỉ được đọc phiếu lương của chính mình, bất kể query gửi lên gì.
function scopePayslipQuery(query, caller) {
  if (isPrivileged(caller)) return { ...query };
  if (!caller.userId) throw new ForbiddenError("Không xác định được nhân viên đang đăng nhập");
  return { ...query, employeeId: caller.userId };
}

function assertOwnPayslip(row, caller) {
  if (!row || isPrivileged(caller)) return;
  if (String(row.employeeId) !== String(caller.userId)) {
    throw new ForbiddenError("Bạn không có quyền xem phiếu lương của người khác");
  }
}

module.exports = { callerFrom, isPrivileged, scopePayslipQuery, assertOwnPayslip };