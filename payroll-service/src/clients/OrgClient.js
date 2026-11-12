"use strict";

// Client gọi sang organization-service (4002) — timeout 5000ms, không import chéo code.
const axios = require("axios");
const config = require("../config");

async function getEmployeeById(employeeId) {
  const res = await axios.get(`${config.organizationUrl}/api/employees/${employeeId}`, {
    // Lời gọi nội bộ giữa các service không đi qua gateway nên phải tự kèm
    // danh tính: organization-service scope đường đọc theo header này, thiếu
    // thì mọi lời gọi sẽ bị 403.
    headers: { "x-user-role": "admin" },
    timeout: 5000,
  });
  return res.data.data;
}

module.exports = { getEmployeeById };
