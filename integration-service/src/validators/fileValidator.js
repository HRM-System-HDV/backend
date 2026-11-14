"use strict";

const config = require("../config");

const FOLDER_RE = /^hrm(\/[a-z0-9_-]+){0,2}$/;

const MIME_TYPES = {
  "application/pdf": {ext:"pdf",format:"pdf",matches:b=>b.length>=5 && b.toString("ascii",0,5)==="%PDF-"},
  "image/jpeg": {
    ext: "jpg",
    format: "jpg",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  "image/png": {
    ext: "png",
    format: "png",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  "image/webp": {
    ext: "webp",
    format: "webp",
    matches: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
};

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  return err;
}

function validateFolder(folder) {
  const value = folder == null || folder === "" ? "hrm" : String(folder);
  if (!FOLDER_RE.test(value)) {
    throw validationError("Thư mục lưu trữ không hợp lệ (chỉ nhận hrm hoặc hrm/<tên>)");
  }
  return value;
}

// Chỉ nhận Data URL base64; soi magic bytes để MIME khai báo không bị giả mạo.
function parseDataUrl(input, maxBytes = config.maxUploadBytes) {
  if (typeof input !== "string" || !input.trim()) {
    throw validationError("Thiếu dữ liệu file ảnh (cần base64 Data URL)");
  }
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    throw validationError("Chỉ chấp nhận ảnh dạng Base64 Data URL, không nhận URL từ xa");
  }
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) {
    throw validationError("Dữ liệu ảnh phải là Data URL dạng data:image/...;base64,...");
  }
  const mime = match[1].toLowerCase();
  const spec = MIME_TYPES[mime];
  if (!spec) {
    throw validationError("Định dạng tệp không được hỗ trợ (JPEG, PNG, WEBP, PDF)");
  }
  const base64 = match[2].replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw validationError("Chuỗi base64 không hợp lệ");
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw validationError("Tệp ảnh rỗng");
  }
  if (buffer.length > maxBytes) {
    throw validationError(`Ảnh vượt quá dung lượng cho phép (${Math.floor(maxBytes / (1024 * 1024))}MB)`);
  }
  if (!spec.matches(buffer)) {
    throw validationError("Nội dung tệp không khớp định dạng ảnh khai báo");
  }
  return { mime, buffer, ext: spec.ext, format: spec.format };
}

module.exports = { validateFolder, parseDataUrl, MIME_TYPES };
