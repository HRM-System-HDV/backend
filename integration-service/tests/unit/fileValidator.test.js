"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");
const { validateFolder, parseDataUrl } = require("../../src/validators/fileValidator");

// PNG 1x1 thật, hợp lệ magic bytes.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

describe("fileValidator", () => {
  test("validateFolder nhận hrm và folder con hợp lệ", () => {
    assert.equal(validateFolder(undefined), "hrm");
    assert.equal(validateFolder("hrm"), "hrm");
    assert.equal(validateFolder("hrm/avatars"), "hrm/avatars");
    assert.equal(validateFolder("hrm/tasks"), "hrm/tasks");
  });

  test("validateFolder chặn folder lạ và traversal", () => {
    for (const bad of ["other", "hrm/../etc", "hrm/Avatars", "/hrm", "hrm/a/b/c"]) {
      assert.throws(() => validateFolder(bad), /không hợp lệ/);
    }
  });

  test("parseDataUrl giải mã PNG hợp lệ", () => {
    const result = parseDataUrl(PNG_DATA_URL);
    assert.equal(result.mime, "image/png");
    assert.equal(result.ext, "png");
    assert.ok(result.buffer.length > 0);
  });

  test("parseDataUrl chặn thiếu dữ liệu, URL từ xa, MIME lạ", () => {
    assert.throws(() => parseDataUrl(""), /Thiếu dữ liệu/);
    assert.throws(() => parseDataUrl(null), /Thiếu dữ liệu/);
    assert.throws(() => parseDataUrl("https://example.com/a.png"), /không nhận URL từ xa/);
    assert.throws(() => parseDataUrl("data:image/gif;base64,R0lGOD"), /không được hỗ trợ/);
    assert.throws(() => parseDataUrl("khong-phai-data-url"), /Data URL/);
  });

  test("parseDataUrl chặn magic bytes giả mạo", () => {
    const fake = Buffer.from("day khong phai anh png that").toString("base64");
    assert.throws(() => parseDataUrl(`data:image/png;base64,${fake}`), /không khớp định dạng/);
  });

  test("parseDataUrl chặn vượt dung lượng", () => {
    assert.throws(() => parseDataUrl(PNG_DATA_URL, 10), /vượt quá dung lượng/);
  });
});