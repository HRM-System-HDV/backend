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

module.exports = { deleteFileByUrl, publicIdFromUrl };