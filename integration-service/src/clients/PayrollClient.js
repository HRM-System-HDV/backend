"use strict";

const config = require("../config");

// Client gọi payroll-service (cổng 4004) của D qua HTTP với timeout tối đa 5000ms (RULES §6).
// Không import chéo mã nguồn.
async function createPayout(payoutData) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = `${config.payrollServiceUrl}/api/payroll/payouts`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payoutData),
      signal: controller.signal,
    });

    const body = await res.json();
    return { status: res.status, body };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Gọi payroll-service vượt quá thời gian chờ 5000ms");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  createPayout,
};
