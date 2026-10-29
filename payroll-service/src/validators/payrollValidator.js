"use strict";

function validatePayout(body = {}) {
  const errors = [];
  if (!body.idempotencyKey) errors.push("Thiếu idempotencyKey");
  if (!body.debitAccount) errors.push("Thiếu tài khoản trích nợ");
  if (body.totalAmount === undefined || body.totalAmount === null) errors.push("Thiếu tổng tiền chi");
  else if (Number(body.totalAmount) <= 0) errors.push("Tổng tiền chi phải lớn hơn 0");
  return errors;
}

function validateGenerate(body = {}) {
  const errors = [];
  if (!body.employeeId) errors.push("Thiếu employeeId");
  if (!body.month) errors.push("Thiếu tháng (MM-YYYY)");
  else if (!/^\d{2}-\d{4}$/.test(body.month)) errors.push("Tháng phải đúng định dạng MM-YYYY");
  if (body.baseSalary === undefined && body.autoFetch !== true) {
    errors.push("Thiếu lương cơ bản (hoặc bật autoFetch để lấy từ organization-service)");
  }
  return errors;
}

function monthToQuery(monthMMYYYY) {
  const [mm, yyyy] = monthMMYYYY.split("-");
  return `${yyyy}-${mm}`;
}

module.exports = { validatePayout, validateGenerate, monthToQuery };
