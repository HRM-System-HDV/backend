"use strict";

const database = require("../src/config/database");

const SEED_REQUESTS = [];
const SEED_NOTIFICATIONS = [];
const SEED_NEWS = [];
const SEED_REGULATIONS = [];
const SEED_WIFI_CONFIGS = [];

async function seed() {
  const prisma = database.getPrisma();
  if (!prisma) {
    return { mode: "memory" };
  }

  try {
    await prisma.request.deleteMany({}).catch(() => {});
    await prisma.notification.deleteMany({}).catch(() => {});
    await prisma.news.deleteMany({}).catch(() => {});
    await prisma.regulation.deleteMany({}).catch(() => {});
    await prisma.wifiConfig.deleteMany({}).catch(() => {});
    await prisma.soapGatewayConfig.deleteMany({}).catch(() => {});
  } catch (_) {}

  return { mode: "postgres" };
}

if (require.main === module) {
  database.connect().then(seed).then(() => process.exit(0)).catch((e) => {
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
