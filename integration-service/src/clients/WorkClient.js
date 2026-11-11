"use strict";

const config = require("../config");

// work-service lỗi hoặc không trả lời => 502 BAD_GATEWAY, caller không được báo thành công.
function badGatewayError(message) {
  const err = new Error(message);
  err.status = 502;
  err.code = "BAD_GATEWAY";
  return err;
}

// Client gọi work-service (cổng 4003) của B qua HTTP với timeout tối đa 5000ms (RULES §6).
// Không import chéo mã nguồn.
async function updateShift(shiftId, shiftData) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = `${config.workServiceUrl}/api/shifts/${shiftId}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shiftData),
      signal: controller.signal,
    });

    // Body có thể không phải JSON khi gateway/nginx trả lỗi; không được che mất HTTP status.
    const body = await res.json().catch(() => null);
    if (res.status >= 400) {
      const upstream = body && body.error && body.error.message ? `: ${body.error.message}` : "";
      throw badGatewayError(`Đồng bộ phân công ca sang work-service thất bại (HTTP ${res.status})${upstream}`);
    }
    return { status: res.status, body };
  } catch (error) {
    if (error.name === "AbortError") {
      throw badGatewayError("Gọi work-service vượt quá thời gian chờ 5000ms");
    }
    if (error.status === 502) throw error;
    throw badGatewayError(`Không gọi được work-service: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  updateShift,
};
