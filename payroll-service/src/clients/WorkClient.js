"use strict";

// Client gọi sang work-service (4003) lấy phạt chấm công — timeout 5000ms.
const axios = require("axios");
const config = require("../config");

async function getAttendance({ employeeId, month }) {
  const res = await axios.get(`${config.workUrl}/api/attendance`, {
    params: { employeeId, month },
    timeout: 5000,
  });
  return res.data.data;
}

module.exports = { getAttendance };
