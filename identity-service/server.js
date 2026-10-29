"use strict";

require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");
const database = require("./src/config/database");
const AuthService = require("./src/services/AuthService");

async function startServer() {
  try {
    await database.connect();
    await AuthService.ensureSeeded().catch((e) => {
      console.warn("[identity-service] Seed bỏ qua:", e.message);
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
