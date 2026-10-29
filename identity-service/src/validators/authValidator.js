"use strict";

function validateLogin(body = {}) {
  const errors = [];
  if (!body.email || typeof body.email !== "string" || !body.email.includes("@")) {
    errors.push("email phải là địa chỉ email hợp lệ");
  }
  if (!body.password || typeof body.password !== "string" || body.password.length < 4) {
    errors.push("password tối thiểu 4 ký tự");
  }
  return errors;
}

function validateChangePassword(body = {}) {
  const errors = [];
  if (!body.currentPassword || typeof body.currentPassword !== "string") {
    errors.push("currentPassword là bắt buộc");
  }
  if (!body.newPassword || typeof body.newPassword !== "string" || body.newPassword.length < 6) {
    errors.push("newPassword phải từ 6 ký tự trở lên");
  }
  return errors;
}

function validateForgotPassword(body = {}) {
  const errors = [];
  if (!body.email || typeof body.email !== "string" || !body.email.includes("@")) {
    errors.push("email phải là địa chỉ email hợp lệ");
  }
  return errors;
}

module.exports = { validateLogin, validateChangePassword, validateForgotPassword };

