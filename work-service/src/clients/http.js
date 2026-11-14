"use strict";
const config = require("../config");
const { InternalServerError, NotFoundError } = require("../utils/errors");
async function request(base, path, options = {}) {
  if (!config.internalToken) throw new InternalServerError("Chưa cấu hình INTERNAL_API_TOKEN cho kết nối nội bộ");
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", "x-internal-token": config.internalToken, ...options.headers },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (response.status === 404) throw new NotFoundError(body.error?.message);
    if (!response.ok) throw new InternalServerError(body.error?.message || "Dịch vụ nội bộ không phản hồi hợp lệ");
    return body.data;
  } catch (error) {
    if (error.status) throw error;
    throw new InternalServerError("Không kết nối được dịch vụ nội bộ trong 5000ms", error);
  }
}
module.exports = { request };
