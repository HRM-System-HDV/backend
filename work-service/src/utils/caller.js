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

function requireUserId(caller) {
  if (!caller.userId) {
    throw new ForbiddenError("Không xác định được nhân viên đang đăng nhập");
  }
  return caller.userId;
}

// Chấm công / đăng ký ca: nhân viên không được làm thay người khác.
function assertSelfEmployee(body, caller) {
  if (isPrivileged(caller)) return body;
  const userId = requireUserId(caller);
  if (body.employeeId && String(body.employeeId) !== String(userId)) {
    throw new ForbiddenError("Không được chấm công hoặc đăng ký ca thay người khác");
  }
  return { ...body, employeeId: userId };
}

// Nhân viên chỉ đọc bản ghi của chính mình, bất kể query gửi lên gì.
function scopeOwnQuery(query, caller) {
  if (isPrivileged(caller)) return { ...query };
  return { ...query, employeeId: requireUserId(caller) };
}

// Nhân viên thấy nhiệm vụ giao riêng cho mình, cộng thêm nhiệm vụ theo ca
// (sourceType "shift") của chi nhánh mình: nhiệm vụ theo ca không có một
// người nhận cụ thể (assignedTo = null) nên giao cho cả ca.
function scopeTaskQuery(query, caller) {
  if (isPrivileged(caller)) return { ...query };
  const userId = requireUserId(caller);
  return {
    ...query,
    assignedTo: userId,
    includeShiftTasksOfBranch: caller.branchSlug || null,
  };
}

// Quản lý chỉ được thao tác bản ghi thuộc chi nhánh của mình. Admin thì
// không giới hạn. Không có chi nhánh trong token thì quản lý không được
// thao tác bản ghi nào.
function assertBranchScope(row, caller, message) {
  if (!row) return;
  if (caller.role === "admin") return;
  if (caller.role !== "manager") return;
  const own = String(caller.branchSlug || "").toLowerCase();
  const target = String(row.branchSlug || "").toLowerCase();
  if (!own || !target || own !== target) {
    throw new ForbiddenError(message);
  }
}

// Ca làm là lịch chung của chi nhánh: nhân viên cần thấy để đăng ký, nhưng chỉ
// trong chi nhánh của mình.
function scopeBranchQuery(query, caller) {
  if (caller.role === "admin") return { ...query };
  if (caller.branchSlug) return { ...query, branchSlug: caller.branchSlug };
  return scopeOwnQuery(query, caller);
}

module.exports = {
  callerFrom,
  isPrivileged,
  assertSelfEmployee,
  scopeOwnQuery,
  scopeTaskQuery,
  scopeBranchQuery,
  assertBranchScope,
};