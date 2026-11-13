"use strict";
const config = require("../config");
const { ForbiddenError, UnauthorizedError } = require("./errors");
const selfFields = ["name","phone","gender","birthDate","province","ward","street","cccd","issueDate","issuePlace","cccdFront","cccdBack","avatar","bankName","bankAccountNumber","bankAccountName"];
function callerFrom(req) {
  return {
    userId: req.get("x-user-id") || null,
    employeeId: req.get("x-employee-id") || null,
    branchId: req.get("x-branch-id") || null,
    email: (req.get("x-user-email") || "").toLowerCase(),
    role: req.get("x-user-role") || null,
    internal: Boolean(config.internalToken) && req.get("x-internal-token") === config.internalToken,
  };
}
function assertAuthenticated(caller) {
  // Chưa xác thực => 401 UNAUTHORIZED; đã xác thực nhưng thiếu quyền => 403 FORBIDDEN.
  if (caller?.internal || (caller?.userId && ["admin","manager","staff"].includes(caller.role))) return;
  throw new UnauthorizedError("Chưa xác thực, vui lòng đăng nhập để tiếp tục");
}
function isSelf(row, caller) { return Boolean(caller.employeeId) && row.id === caller.employeeId; }
function assertEmployeeRead(row, caller) {
  assertAuthenticated(caller);
  if (caller.internal || caller.role === "admin" || isSelf(row, caller) || (caller.role === "manager" && caller.branchId && row.branchId === caller.branchId)) return;
  throw new ForbiddenError("Bạn không có quyền xem hồ sơ nhân sự này");
}
function employeeScope(query, caller) {
  assertAuthenticated(caller);
  if (caller.internal || caller.role === "admin") return {...query};
  if (caller.role === "manager" && caller.branchId) return {...query, branchId:caller.branchId};
  return {...query, id: caller.employeeId || "00000000-0000-4000-8000-000000000000"};
}
function assertEmployeeWrite(existing, payload, caller, creating = false) {
  assertAuthenticated(caller);
  if (caller.internal && !caller.userId) throw new ForbiddenError("Kết nối nội bộ chỉ được đọc dữ liệu nhân sự");
  if (caller.role === "admin") return payload;
  if (caller.role === "manager") {
    if (!caller.branchId || (existing && existing.branchId !== caller.branchId) || (payload.branchId !== undefined && payload.branchId !== caller.branchId)) throw new ForbiddenError("Quản lý chỉ được thao tác nhân sự chi nhánh của mình");
    if (!creating && payload.email !== undefined && payload.email !== existing.email) throw new ForbiddenError("Chỉ admin được đổi email đăng nhập");
    return creating ? {...payload, branchId:caller.branchId} : payload;
  }
  if (!creating && existing && isSelf(existing, caller) && Object.keys(payload).every(key => selfFields.includes(key))) return payload;
  throw new ForbiddenError("Bạn không có quyền sửa thông tin nhân sự này");
}
function assertAdmin(caller) { assertAuthenticated(caller); if (caller.role !== "admin") throw new ForbiddenError("Chức năng này chỉ dành cho admin"); }
function assertManager(caller) { assertAuthenticated(caller); if (!["admin","manager"].includes(caller.role)) throw new ForbiddenError("Chức năng này dành cho quản lý hoặc admin"); }
module.exports = { callerFrom, assertAuthenticated, isSelf, assertEmployeeRead, employeeScope, assertEmployeeWrite, assertAdmin, assertManager };
