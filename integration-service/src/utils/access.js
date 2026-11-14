"use strict";
const crypto = require("node:crypto");
const config = require("../config");
function error(message, status = 400, code = "VALIDATION_ERROR") { return Object.assign(new Error(message), {status, code}); }
function actor(req) {
  let name = req.headers["x-user-name"] || null;
  try { if (name) name = decodeURIComponent(name); } catch {}
  const supplied = String(req.headers["x-internal-token"] || "");
  const expected = String(config.internalToken || "");
  const internal = !!supplied && !!expected && Buffer.byteLength(supplied) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  const who = {userId:req.headers["x-user-id"] || null, employeeId:req.headers["x-employee-id"] || null, branchId:req.headers["x-branch-id"] || null, role:req.headers["x-user-role"] || null, name, internal};
  if (!internal && (!who.userId || !["admin","manager","staff"].includes(who.role))) throw error("Vui lòng đăng nhập",401,"UNAUTHORIZED");
  return who;
}
function admin(who) { if (who.role !== "admin") throw error("Chỉ admin được quản trị hệ thống",403,"FORBIDDEN"); }
function manager(who) { if (!["admin","manager"].includes(who.role)) throw error("Bạn không có quyền quản lý",403,"FORBIDDEN"); }
function branch(who, value, write = false) {
  if (who.role === "admin" || who.internal && !write) return;
  if (write ? !who.branchId || value !== who.branchId : value != null && value !== who.branchId) throw error("Dữ liệu ngoài chi nhánh được phép",403,"FORBIDDEN");
}
function uuid(value, name = "id") { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""))) throw error(`${name} phải là UUID`); return value; }
module.exports = {actor, admin, manager, branch, uuid, error};
