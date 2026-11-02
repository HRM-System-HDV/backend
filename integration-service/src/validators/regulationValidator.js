"use strict";

const VALID_STATUSES = ["hiệu lực", "dự thảo", "hết hiệu lực"];

function validateCreateRegulation(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Payload nội quy không hợp lệ"];
  }
  // Mã nội quy (code) tự động sinh NQ-XXXX nếu để trống
  if (payload.code !== undefined && payload.code !== null && typeof payload.code !== "string") {
    errors.push("Mã nội quy (code) phải là chuỗi ký tự");
  }
  if (!payload.title || !payload.title.trim()) {
    errors.push("Tiêu đề nội quy là bắt buộc");
  }
  if (!payload.category || !payload.category.trim()) {
    errors.push("Danh mục nội quy là bắt buộc");
  }
  if (!payload.content || !payload.content.trim()) {
    errors.push("Nội dung nội quy là bắt buộc");
  }
  if (payload.status && !VALID_STATUSES.includes(payload.status)) {
    errors.push(`Trạng thái không hợp lệ. Cho phép: ${VALID_STATUSES.join(", ")}`);
  }
  return errors;
}

module.exports = {
  VALID_STATUSES,
  validateCreateRegulation,
};
