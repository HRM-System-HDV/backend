"use strict";

function validateCreateNotification(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Payload thông báo không hợp lệ"];
  }
  if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
    errors.push("Tiêu đề thông báo là bắt buộc");
  }
  if (!payload.body || typeof payload.body !== "string" || !payload.body.trim()) {
    errors.push("Nội dung thông báo là bắt buộc");
  }
  return errors;
}

module.exports = {
  validateCreateNotification,
};
