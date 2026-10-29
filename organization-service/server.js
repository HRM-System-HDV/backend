"use strict";

require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");
const database = require("./src/config/database");

async function startServer() {
  try {
    await database.connect();
    const seed = require("./prisma/seed");
    await seed.ensureSeeded().catch((e) => {
      console.warn("[organization-service] Seed bỏ qua:", e.message);
    });
    if (require.main === module) {
      app.listen(config.port, () => {
        console.log(`[${config.serviceName}] running at http://localhost:${config.port}`);
      });
    }
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to start:`, error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
