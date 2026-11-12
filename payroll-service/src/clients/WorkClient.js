"use strict";
const axios = require("axios");
const config = require("../config");
const { InternalServerError } = require("../utils/errors");
async function getAttendance(params) {
  try {
    const response = await axios.get(`${config.workUrl}/api/attendance`, { params, headers: { "x-internal-token": config.internalToken }, timeout: 5000 });
    return response.data.data;
  } catch { throw new InternalServerError("Không đọc được chấm công từ Work"); }
}
module.exports = { getAttendance };
