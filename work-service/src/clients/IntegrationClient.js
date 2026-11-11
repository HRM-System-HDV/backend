"use strict";

const config = require("../config");

// Gọi integration-service (4005) xóa ảnh nội bộ khi bản ghi sở hữu ảnh bị xóa.
// Best-effort, timeout 5000ms (RULES §6); ảnh mồ côi còn lại có scan-orphans đối soát.
function publicIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = "/api/files/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length).split(/[?#]/)[0] || null;
}

async function deleteFileByUrl(url) {
  const publicId = publicIdFromUrl(url);
  if (!publicId) return { skipped: true };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${config.integrationServiceUrl}/api/files/${publicId}`, {
      method: "DELETE",
      signal: controller.signal,
    });
    // 404 = file đã xóa trước đó, vẫn coi là thành công (idempotent).
    return { ok: res.ok || res.status === 404, status: res.status };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Gọi integration-service vượt quá thời gian chờ 5000ms");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Thông báo cho admin/manager của một chi nhánh (branchSlug + targetEmployeeId = null
// nên bản ghi nằm trong phạm vi xem của cả manager chi nhánh đó lẫn admin).
// Cùng kiểu gọi nội bộ, cùng timeout 5000ms (RULES §6) như deleteFileByUrl.
async function createBranchNotification(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${config.integrationServiceUrl}/api/notifications`, {
      method: "POST",
      // integration-service lấy chi nhánh từ header do gateway ký (writeBranchSlug),
      // nên lời gọi nội bộ không kèm header sẽ bị bỏ branchSlug và thông báo thành
      // broadcast toàn hệ thống — lộ danh tính nhân viên quên chốt ra.
      headers: { "Content-Type": "application/json", "x-user-role": "admin" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`integration-service trả ${res.status} cho POST /api/notifications`);
    }
    return { ok: true, status: res.status };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Gọi integration-service vượt quá thời gian chờ 5000ms");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { deleteFileByUrl, publicIdFromUrl, createBranchNotification };