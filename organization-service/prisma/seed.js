"use strict";

// Seed tối thiểu: 3 chi nhánh + 2 phòng ban + 3 nhân sự khớp identity-service.
const database = require("../src/config/database");
const OrgService = require("../src/services/OrgService");

async function ensureSeeded() {
  return OrgService.ensureSeeded();
}

module.exports = { ensureSeeded };
