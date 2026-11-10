"use strict";

require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");
const database = require("./src/config/database");

async function startServer() {
  try {
    await database.connect();
    await require("node:fs/promises").mkdir(config.storageDir, { recursive: true });
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
