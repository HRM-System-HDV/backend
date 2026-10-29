"use strict";

const config = require("../config");

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

    const body = await res.json();
    return { status: res.status, body };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Gọi work-service vượt quá thời gian chờ 5000ms");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  updateShift,
};
