"use strict";

const VALID_TONES = ["danger", "warning", "success", "primary", "gray"];

function validateCreateNews(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Payload bảng tin không hợp lệ"];
  }
  if (!payload.title || !payload.title.trim()) {
    errors.push("Tiêu đề tin tức là bắt buộc");
  }
  if (!payload.summary || !payload.summary.trim()) {
    errors.push("Tóm tắt tin tức là bắt buộc");
  }
  if (!payload.content || !payload.content.trim()) {
    errors.push("Nội dung tin tức là bắt buộc");
  }
  if (payload.tagTone && !VALID_TONES.includes(payload.tagTone)) {
    errors.push(`Tone màu không hợp lệ. Cho phép: ${VALID_TONES.join(", ")}`);
  }
  return errors;
}

module.exports = {
  VALID_TONES,
  validateCreateNews,
};
