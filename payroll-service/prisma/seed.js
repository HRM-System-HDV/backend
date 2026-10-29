"use strict";

// Seed tối thiểu: tài khoản công ty đủ số dư demo.
const PayrollService = require("../src/services/PayrollService");

async function ensureSeeded() {
  return PayrollService.ensureSeeded();
}

module.exports = { ensureSeeded };
