"use strict";
const { timingSafeEqual } = require("node:crypto");
const config = require("../config");
const { UnauthorizedError } = require("./errors");
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
  // Chưa xác thực (vô danh / token sai) => 401 UNAUTHORIZED.
  // Đã xác thực nhưng thiếu quyền => 403 FORBIDDEN (do nơi gọi ném ForbiddenError).
  if (!caller || (!caller.internal && (!caller.userId || !["admin", "manager", "staff"].includes(caller.role)))) {
    throw new UnauthorizedError("Chưa xác thực, vui lòng đăng nhập để tiếp tục");
  }
}
function isPrivileged(caller) { return caller?.role === "admin" || caller?.role === "manager"; }
module.exports = { callerFrom, requireCaller, isPrivileged };
