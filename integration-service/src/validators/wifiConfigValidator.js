"use strict";

const VALID_STATUSES = ["hoạt động", "vô hiệu hóa"];

function validateCreateWifiConfig(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["Payload Wi-Fi không hợp lệ"];
  }
  if (!payload.ssid || !payload.ssid.trim()) {
    errors.push("SSID Wi-Fi là bắt buộc");
  }
  if (!payload.bssid || !payload.bssid.trim()) {
    errors.push("BSSID Wi-Fi là bắt buộc");
  }
  if (!payload.branch || !payload.branch.trim()) {
    errors.push("Chi nhánh (branch slug) là bắt buộc");
  }
  if (payload.status && !VALID_STATUSES.includes(payload.status)) {
    errors.push(`Trạng thái không hợp lệ. Cho phép: ${VALID_STATUSES.join(", ")}`);
  }
  return errors;
}

module.exports = {
  VALID_STATUSES,
  validateCreateWifiConfig,
};
