"use strict";

// Client gọi sang work-service (4003) lấy phạt chấm công — timeout 5000ms.
const axios = require("axios");
const config = require("../config");

async function getAttendance({ employeeId, month }) {
  const res = await axios.get(`${config.workUrl}/api/attendance`, {
    params: { employeeId, month },
    // work-service scope đường đọc theo danh tính do gateway ký; lời gọi nội bộ
    // không kèm header bị chặn 403 và PayrollService nuốt thành cảnh báo, khiến
    // phiếu lương mất luôn phần phạt chấm công.
    headers: { "x-user-role": "admin" },
    timeout: 5000,
  });
  return res.data.data;
}

module.exports = { getAttendance };
