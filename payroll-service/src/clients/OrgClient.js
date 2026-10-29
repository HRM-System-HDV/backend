"use strict";

// Client gọi sang organization-service (4002) — timeout 5000ms, không import chéo code.
const axios = require("axios");
const config = require("../config");

async function getEmployeeById(employeeId) {
  const res = await axios.get(`${config.organizationUrl}/api/employees/${employeeId}`, {
    timeout: 5000,
  });
  return res.data.data;
}

module.exports = { getEmployeeById };
