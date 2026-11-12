"use strict";
const axios = require("axios");
const config = require("../config");
const { InternalServerError } = require("../utils/errors");
async function getEmployeeById(id) {
  try {
    const response = await axios.get(`${config.organizationUrl}/api/employees/${id}`, { headers: { "x-internal-token": config.internalToken }, timeout: 5000 });
    return response.data.data;
  } catch { throw new InternalServerError("Không đọc được hồ sơ từ Organization"); }
}
module.exports = { getEmployeeById };
