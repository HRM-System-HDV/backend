"use strict";
const { timingSafeEqual } = require("node:crypto");
const config = require("../config");
const { ForbiddenError } = require("./errors");
function callerFrom(req) {
  let name = req.headers["x-user-name"] || "Người dùng";
  try { name = decodeURIComponent(name); } catch {}
  const provided = Buffer.from(String(req.headers["x-internal-token"] || ""));
  const expected = Buffer.from(String(config.internalToken || ""));
  const internal = expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
  return { userId: req.headers["x-user-id"] || null, employeeId: req.headers["x-employee-id"] || null,
    branchId: req.headers["x-branch-id"] || null, role: req.headers["x-user-role"] || null,
    name, internal };
}
function requireCaller(caller) {
  if (!caller || (!caller.internal && (!caller.userId || !["admin", "manager", "staff"].includes(caller.role)))) {
    throw new ForbiddenError("Không xác định được danh tính đã xác thực");
  }
}
function isPrivileged(caller) { return caller?.role === "admin" || caller?.role === "manager"; }
function assertAdmin(caller) { requireCaller(caller); if (caller.internal || caller.role !== "admin") throw new ForbiddenError("Chỉ quản trị viên được thay đổi cấu hình hệ thống"); }
module.exports = { callerFrom, requireCaller, isPrivileged, assertAdmin };
