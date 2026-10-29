"use strict";

require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");
const database = require("./src/config/database");
const { seed } = require("./prisma/seed");

async function startServer() {
  try {
    await database.connect();
    // Tự động seed nếu kết nối được Postgres
    await seed().catch((e) => {
      console.warn("[integration-service] Seed bỏ qua:", e.message);
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
