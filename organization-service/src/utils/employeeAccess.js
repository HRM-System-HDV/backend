"use strict";

const { ForbiddenError } = require("./errors");

// Danh tính do gateway chuyển xuống sau khi đã verify JWT và xóa header giả mạo.
// Service chỉ tin các header này khi nằm sau gateway.
const SENSITIVE_FIELDS = [
  "cccd", "issueDate", "issuePlace", "cccdFront", "cccdBack",
  "baseSalary", "salaryType", "hourlySalary",
  "bankName", "bankAccountNumber", "bankAccountName",
  "phone", "birthDate", "province", "ward", "street",
];

function callerFrom(req) {
  return {
    userId: req.headers["x-user-id"] || null,
    email: String(req.headers["x-user-email"] || "").toLowerCase(),
    role: req.headers["x-user-role"] || "staff",
    branchSlug: req.headers["x-branch-slug"] || null,
  };
}

function isSelf(row, caller) {
  if (!row) return false;
  if (caller.userId && String(row.id) === String(caller.userId)) return true;
  return Boolean(caller.email) && String(row.email || "").toLowerCase() === caller.email;
}

function canSeeSensitive(row, caller) {
  return caller.role === "admin" || caller.role === "manager" || isSelf(row, caller);
}

// Nhân viên thường chỉ thấy danh bạ đồng nghiệp (tên, email, phòng ban) để
// đổi ca / nhờ làm thay; CCCD, lương, tài khoản ngân hàng phải ẩn.
function redactEmployee(row, caller) {
  if (!row || canSeeSensitive(row, caller)) return row;
  const out = { ...row };
  for (const field of SENSITIVE_FIELDS) delete out[field];
  return out;
}

// Admin xem mọi chi nhánh. Quản lý/nhân viên chỉ xem chi nhánh của mình;
// không có chi nhánh thì chỉ xem đúng hồ sơ của chính mình.
function scopeEmployeeQuery(query, caller) {
  if (caller.role === "admin") return { ...query };
  if (caller.branchSlug) return { ...query, branchSlug: caller.branchSlug };
  const self = {};
  if (caller.userId) self.id = caller.userId;
  else if (caller.email) self.email = caller.email;
  else self.id = "__khong_co_ho_so__";
  return { ...self };
}

function assertCanReadEmployee(row, caller) {
  if (caller.role === "admin") return;
  if (isSelf(row, caller)) return;
  if (caller.role === "manager" && caller.branchSlug && row.branchSlug === caller.branchSlug) return;
  if (caller.branchSlug && row.branchSlug === caller.branchSlug) return;
  throw new ForbiddenError("Bạn không có quyền xem hồ sơ nhân sự này");
}

// Nhân viên tự sửa được hồ sơ cá nhân, nhưng không được tự nâng vai trò, đổi
// lương, đổi chi nhánh hay đổi email đăng nhập.
const SELF_EDITABLE_FIELDS = [
  "name", "phone", "gender", "birthDate", "province", "ward", "street",
  "cccd", "issueDate", "issuePlace", "cccdFront", "cccdBack", "avatar",
  "bankName", "bankAccountNumber", "bankAccountName",
];

// Nhóm field chỉ admin được thay đổi: vai trò hệ thống, chi nhánh, email đăng nhập
// và lương. Gateway chỉ chặn theo vai trò chứ không theo từng field, nên service phải
// lọc chúng ở mọi payload sửa hồ sơ thường để chặn leo quyền / đổi lương trái phép.
const PRIVILEGED_WRITE_FIELDS = ["systemRole", "branchSlug", "email", "baseSalary"];

function omitPrivilegedFields(body) {
  const out = { ...body };
  for (const field of PRIVILEGED_WRITE_FIELDS) delete out[field];
  return out;
}

function assertCanWriteEmployee(row, caller, body) {
  if (caller.role === "admin") return body;
  if (caller.role === "manager") {
    // Manager chỉ sửa thông tin nhân sự, không được tự nâng quyền/chuyển chi nhánh/
    // đổi email/chỉnh lương kể cả khi sửa hồ sơ của chính mình.
    if (isSelf(row, caller)) return omitPrivilegedFields(body);
    if (caller.branchSlug && row.branchSlug === caller.branchSlug) return omitPrivilegedFields(body);
    throw new ForbiddenError("Quản lý chỉ sửa được hồ sơ thuộc chi nhánh của mình");
  }
  if (!isSelf(row, caller)) {
    throw new ForbiddenError("Bạn chỉ được sửa hồ sơ của chính mình");
  }
  const filtered = {};
  for (const field of SELF_EDITABLE_FIELDS) {
    if (body[field] !== undefined) filtered[field] = body[field];
  }
  const dropped = Object.keys(body).filter((k) => !(k in filtered));
  if (dropped.length) {
    throw new ForbiddenError(`Nhân viên không được sửa các trường: ${dropped.join(", ")}`);
  }
  return filtered;
}

// Tạo hồ sơ mới là đường leo quyền còn lại: gateway chỉ chặn theo vai trò
// (manager ghi được /api/employees) nên service phải chặn manager tự dựng tài
// khoản admin hoặc dựng nhân sự chen vào chi nhánh khác.
function assertCanCreateEmployee(caller, body) {
  if (caller.role === "admin") return body;
  if (caller.role !== "manager") {
    throw new ForbiddenError("Bạn không có quyền tạo hồ sơ nhân sự");
  }
  const requestedRole = body.systemRole || "staff";
  if (requestedRole !== "staff") {
    throw new ForbiddenError("Quản lý chỉ tạo được hồ sơ nhân viên, không tạo được quản lý hoặc quản trị viên");
  }
  if (!caller.branchSlug) {
    throw new ForbiddenError("Tài khoản quản lý chưa được gán chi nhánh");
  }
  return { ...body, systemRole: "staff", branchSlug: caller.branchSlug };
}

// Xóa hồ sơ là quyền nhạy cảm mà gateway không phân theo từng bản ghi: manager chỉ// xóa được người cùng chi nhánh, và manager/staff không được xóa tài khoản admin để
// chặn gỡ bỏ người ở trên quyền hoặc xóa chéo chi nhánh.
function assertCanDeleteEmployee(row, caller) {
  if (!row) return;
  if (caller.role === "admin") return;
  if (row.systemRole === "admin") {
    throw new ForbiddenError("Bạn không có quyền xóa tài khoản của quản trị viên");
  }
  if (caller.role === "manager") {
    if (caller.branchSlug && row.branchSlug === caller.branchSlug) return;
    throw new ForbiddenError("Quản lý chỉ xóa được hồ sơ thuộc chi nhánh của mình");
  }
}

module.exports = {
  callerFrom,
  isSelf,
  redactEmployee,
  scopeEmployeeQuery,
  assertCanReadEmployee,
  assertCanWriteEmployee,
  assertCanCreateEmployee,
  assertCanDeleteEmployee,
};