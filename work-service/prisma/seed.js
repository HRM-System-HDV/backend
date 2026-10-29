"use strict";

// Seed tối thiểu cho work-service (memory + postgres upsert).
const WorkService = require("../src/services/WorkService");

async function ensureSeeded() {
  return WorkService.ensureSeeded();
}

module.exports = { ensureSeeded };
