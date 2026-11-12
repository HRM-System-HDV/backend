"use strict";
const { ValidationError } = require("../utils/errors");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const employeeFields = ["name","email","phone","gender","birthDate","province","ward","street","cccd","issueDate","issuePlace","cccdFront","cccdBack","avatar","branchId","departmentId","positionId","status","resignedAt","joinDate","salaryType","salary","standardWorkDays","bankName","bankAccountNumber","bankAccountName"];
const fields = {
  branch: ["name","address","managerId","status"],
  department: ["departmentCode","name","managerId","status"],
  position: ["positionCode","name","departmentId","status"],
  employee: employeeFields,
};
const dateFields = ["birthDate","issueDate","resignedAt","joinDate"];
function isDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
function normalize(kind, body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Dữ liệu phải là một đối tượng");
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (!fields[kind].includes(key)) throw new ValidationError(`Trường không hợp lệ: ${key}`);
    if (value === undefined) continue;
    if (key.endsWith("Id")) {
      if (value !== null && !UUID.test(value)) throw new ValidationError(`${key} phải là UUID`);
    } else if (dateFields.includes(key)) {
      if (value !== null && !isDate(value)) throw new ValidationError(`${key} phải là ngày YYYY-MM-DD hợp lệ`);
    } else if (key === "salary") {
      if ((typeof value !== "string" && typeof value !== "number") || !/^\d{1,15}$/.test(String(value))) throw new ValidationError("Lương phải là số nguyên VNĐ không âm, tối đa 15 chữ số");
      out[key] = String(value); continue;
    } else if (key === "standardWorkDays") {
      if (value !== null && (!Number.isInteger(value) || value <= 0)) throw new ValidationError("Số công thỏa thuận phải là số nguyên dương");
    } else if (value !== null && typeof value !== "string") throw new ValidationError(`${key} phải là chuỗi`);
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  if (out.email !== undefined) {
    if (typeof out.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ValidationError("Email không hợp lệ");
    out.email = out.email.toLowerCase();
  }
  for (const code of ["departmentCode", "positionCode"]) if (out[code] !== undefined && !out[code]) throw new ValidationError("Mã nghiệp vụ không được để trống");
  if (out.name !== undefined && !out.name) throw new ValidationError("Tên không được để trống");
  if (out.status !== undefined && !out.status) throw new ValidationError("Trạng thái không được để trống");
  if (out.salaryType !== undefined && !["monthly","hourly"].includes(out.salaryType)) throw new ValidationError("Kiểu lương phải là monthly hoặc hourly");
  if (!partial) {
    const required = kind === "employee" ? ["name","email","salaryType","salary"] : kind === "department" ? ["name","departmentCode"] : kind === "position" ? ["name","positionCode"] : ["name"];
    for (const key of required) if (out[key] === undefined || out[key] === null || out[key] === "") throw new ValidationError(`Thiếu trường bắt buộc: ${key}`);
  }
  return out;
}
function validateEmployeeRules(row) {
  if (row.salaryType === "monthly" && (!Number.isInteger(row.standardWorkDays) || row.standardWorkDays <= 0)) throw new ValidationError("Nhân viên lương tháng phải có số công thỏa thuận lớn hơn 0");
  if (row.salaryType === "hourly" && row.standardWorkDays != null) throw new ValidationError("Nhân viên lương giờ không có số công thỏa thuận");
  if (row.joinDate && row.resignedAt && new Date(row.resignedAt) < new Date(row.joinDate)) throw new ValidationError("Ngày nghỉ việc không được trước ngày vào làm");
}
function validateId(id) { if (!UUID.test(id || "")) throw new ValidationError("ID phải là UUID hợp lệ"); }
module.exports = { normalize, validateEmployeeRules, validateId, dateFields };