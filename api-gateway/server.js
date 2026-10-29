"use strict";

require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");

const PORT = config.port || 4000;

async function startServer() {
  try {
    if (require.main === module) {
      app.listen(PORT, () => {
        console.log(`[${config.serviceName}] running at http://localhost:${PORT}`);
      });
    }
  } catch (error) {
    console.error(`[${config.serviceName}] Failed to start:`, error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
