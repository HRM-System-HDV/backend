"use strict";

function validateShift(body = {}) {
  const errors = [];
  if (!body.employeeId && !body.branchSlug) errors.push("Thiếu employeeId hoặc branchSlug");
  if (!body.date) errors.push("Ngày ca (date DD-MM-YYYY) là bắt buộc");
  return errors;
}

function validateTask(body = {}) {
  const errors = [];
  if (!body.title) errors.push("Tiêu đề tác vụ là bắt buộc");
  if (body.status && !["pending", "in_progress", "done"].includes(body.status)) {
    errors.push("Trạng thái chỉ nhận pending/in_progress/done");
  }
  return errors;
}

function validateAttendance(body = {}) {
  const errors = [];
  if (!body.employeeId) errors.push("Thiếu employeeId");
  return errors;
}

module.exports = { validateShift, validateTask, validateAttendance };
