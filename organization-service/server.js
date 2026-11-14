"use strict";
require("dotenv").config();
const app = require("./src/app");
const config = require("./src/config");
const database = require("./src/config/database");
async function startServer() {
  await database.connect();
  return app.listen(config.port, () => console.log(`[${config.serviceName}] http://localhost:${config.port}`));
}
if (require.main === module) startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = app;