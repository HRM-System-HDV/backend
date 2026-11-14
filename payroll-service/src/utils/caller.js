"use strict";
const config = require("../config");
const { ForbiddenError } = require("./errors");
function callerFrom(req) { return { userId: req.headers["x-user-id"] || null, employeeId: req.headers["x-employee-id"] || null, branchId: req.headers["x-branch-id"] || null, role: req.headers["x-user-role"] || null, internal: !!config.internalToken && req.headers["x-internal-token"] === config.internalToken }; }
function requireAdmin(actor) { if (!actor || (actor.role !== "admin" && !actor.internal)) throw new ForbiddenError("Chỉ quản trị viên được thực hiện thao tác này"); }
function scopePayslipQuery(query, actor) {
  if (!actor || (!actor.userId && !actor.internal)) throw new ForbiddenError("Thiếu danh tính");
  if (actor.role === "admin" || actor.internal) return { ...query };
  if (actor.role === "manager" && actor.branchId) return { ...query, branchId: actor.branchId };
  if (actor.role === "staff" && actor.employeeId) return { ...query, employeeId: actor.employeeId, branchId: undefined };
  throw new ForbiddenError("Không đủ phạm vi nhân sự");
}
function assertOwnPayslip(row, actor) {
  if (actor?.role === "admin" || actor?.internal) return;
  if (actor?.role === "manager" && actor.branchId && actor.branchId === row.branchId) return;
  if (actor?.role === "staff" && actor.employeeId && actor.employeeId === row.employeeId) return;
  throw new ForbiddenError("Không được truy cập phiếu lương ngoài phạm vi");
}
module.exports = { callerFrom, requireAdmin, scopePayslipQuery, assertOwnPayslip };