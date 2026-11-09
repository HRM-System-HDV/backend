"use strict";

const database = require("../src/config/database");

const SEED_REQUESTS = [];
const SEED_NOTIFICATIONS = [];
const SEED_NEWS = [];
const SEED_REGULATIONS = [];
const SEED_WIFI_CONFIGS = [];

// Dữ liệu integration do người dùng tạo ra, không có bộ mẫu: seed không được xóa bảng.
async function seed() {
  const prisma = database.getPrisma();
  if (!prisma) {
    return { mode: "memory" };
  }

  return { mode: "postgres" };
}

if (require.main === module) {
  database.connect()
    .then(seed)
    .then((result) => {
      console.log(`[seed] integration-service (${result.mode}): không có dữ liệu mẫu, giữ nguyên dữ liệu hiện có.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("[seed] Thất bại:", e);
      process.exit(1);
    });
}

module.exports = {
  seed,
  SEED_REQUESTS,
  SEED_NOTIFICATIONS,
  SEED_NEWS,
  SEED_REGULATIONS,
  SEED_WIFI_CONFIGS,
};
