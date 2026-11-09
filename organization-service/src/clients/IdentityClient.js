"use strict";

const config = require("../config");

/**
 * Đồng bộ thông tin nhân viên sang identity-service (bảng users).
 * Đảm bảo tài khoản đăng nhập luôn trùng khớp với hồ sơ nhân sự (email, tên, vai trò, chi nhánh).
 * Không throw lỗi chặn luồng nghiệp vụ nếu identity-service tạm thời không kết nối được.
 * Trả về { ok, conflict?, identityId?, networkError? } để nơi gọi xử lý xung đột mã/email.
 */
async function syncEmployeeToIdentity(employee, action = "upsert") {
  if (!employee) return { ok: false };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${config.identityUrl}/api/auth/sync-employee`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": config.internalToken,
      },
      body: JSON.stringify({ employee, action }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await res.json().catch(() => null);
    if (res.status === 409) {
      return {
        ok: false,
        conflict: body?.error?.code || "CONFLICT",
        identityId: body?.error?.identityId || null,
      };
    }
    if (!res.ok) {
      console.warn(`[IdentityClient] syncEmployeeToIdentity thất bại (${res.status}):`, body);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, ...(body?.data || {}) };
  } catch (err) {
    console.warn(`[IdentityClient] Không thể gọi tới identity-service (${config.identityUrl}):`, err.message);
    return { ok: false, networkError: true };
  }
}

module.exports = { syncEmployeeToIdentity };
