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
// Quản lý chỉ được đọc phiếu lương của chi nhánh mình quản lý (ghim chi nhánh
// theo header do gateway ký), không đọc được toàn công ty.
function scopePayslipQuery(query, caller) {
  if (caller.role === "admin") return { ...query };
  if (caller.role === "manager") {
    if (!caller.branchSlug) {
      throw new ForbiddenError("Tài khoản quản lý chưa được gán chi nhánh");
    }
    return { ...query, branchSlug: caller.branchSlug };
  }
  if (!caller.userId) throw new ForbiddenError("Không xác định được nhân viên đang đăng nhập");
  return { ...query, employeeId: caller.userId };
}

function assertOwnPayslip(row, caller) {
  if (!row) return;
  if (caller.role === "admin") return;
  if (caller.role === "manager") {
    const own = String(caller.branchSlug || "").toLowerCase();
    const target = String(row.branchSlug || "").toLowerCase();
    if (own && target && own === target) return;
    throw new ForbiddenError("Bạn không có quyền xem phiếu lương ngoài chi nhánh của mình");
  }
  if (String(row.employeeId) !== String(caller.userId)) {
    throw new ForbiddenError("Bạn không có quyền xem phiếu lương của người khác");
  }
}

module.exports = { callerFrom, isPrivileged, scopePayslipQuery, assertOwnPayslip };