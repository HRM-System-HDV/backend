"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");
const { validateCreateRequest, canDeleteRequest } = require("../../src/validators/requestValidator");
const { validateCreateNotification } = require("../../src/validators/notificationValidator");
const { validateCreateNews } = require("../../src/validators/newsValidator");
const { validateCreateRegulation } = require("../../src/validators/regulationValidator");
const { validateCreateWifiConfig } = require("../../src/validators/wifiConfigValidator");

describe("Domain Validation Tests", () => {
  test("validateCreateRequest từ chối type không hợp lệ", () => {
    const errors = validateCreateRequest({ type: "invalid", employeeId: "e-1", title: "Test", content: "Test" });
    assert.ok(errors.length > 0);
  });

  test("validateCreateRequest chấp nhận request hợp lệ", () => {
    const errors = validateCreateRequest({ type: "leave", employeeId: "e-1", title: "Nghỉ phép", content: "Lý do cá nhân" });
    assert.equal(errors.length, 0);
  });

  test("canDeleteRequest chỉ cho phép xóa khi status là pending", () => {
    assert.equal(canDeleteRequest("pending"), true);
    assert.equal(canDeleteRequest("approved"), false);
    assert.equal(canDeleteRequest("rejected"), false);
  });

  test("validateCreateNotification kiểm tra title và body", () => {
    assert.ok(validateCreateNotification({}).length > 0);
    assert.equal(validateCreateNotification({ title: "Thông báo", body: "Nội dung" }).length, 0);
  });

  test("validateCreateNews kiểm tra tiêu đề và tone", () => {
    assert.ok(validateCreateNews({}).length > 0);
    assert.equal(validateCreateNews({ title: "Tin", summary: "Tóm tắt", content: "Chi tiết", tagTone: "primary" }).length, 0);
  });

  test("validateCreateRegulation kiểm tra code và content", () => {
    assert.ok(validateCreateRegulation({}).length > 0);
    assert.equal(validateCreateRegulation({ code: "NQ-01", title: "Nội quy", category: "Kỷ luật", content: "Nội dung" }).length, 0);
  });

  test("validateCreateWifiConfig kiểm tra ssid, bssid và branch", () => {
    assert.ok(validateCreateWifiConfig({}).length > 0);
    assert.equal(validateCreateWifiConfig({ ssid: "HRM_WIFI", bssid: "00:11:22:33", branch: "HN-1" }).length, 0);
  });
});
