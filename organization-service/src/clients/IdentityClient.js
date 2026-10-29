"use strict";

const config = require("../config");

/**
 * Đồng bộ thông tin nhân viên sang identity-service (bảng users).
 * Đảm bảo tài khoản đăng nhập luôn trùng khớp với hồ sơ nhân sự (email, tên, vai trò, chi nhánh).
 * Không throw lỗi chặn luồng nghiệp vụ nếu identity-service tạm thời không kết nối được.
 */
async function syncEmployeeToIdentity(employee, action = "upsert") {
  if (!employee) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${config.identityUrl}/api/auth/sync-employee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee, action }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[IdentityClient] syncEmployeeToIdentity thất bại (${res.status}):`, errText);
    }
  } catch (err) {
    console.warn(`[IdentityClient] Không thể gọi tới identity-service (${config.identityUrl}):`, err.message);
  }
}

module.exports = { syncEmployeeToIdentity };
