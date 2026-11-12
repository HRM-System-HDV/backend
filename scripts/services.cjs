"use strict";

// Một runner cho Windows và Unix; không ghép lệnh shell hoặc tự chạy migration khi test.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const commands = {
  test: ["run", "test"],
  coverage: ["run", "test:coverage"],
  install: ["install"],
  generate: ["run", "prisma:generate"],
  deploy: ["run", "prisma:deploy"],
  seed: ["run", "seed"],
};
const action = process.argv[2];
const args = commands[action];
const npmCli = process.env.npm_execpath;
if (!args || !npmCli) {
  console.error("Chạy bằng npm script trong backend/package.json.");
  process.exit(1);
}
const services = ["identity-service", "organization-service", "work-service", "payroll-service", "integration-service"];
if (["test", "coverage", "install"].includes(action)) services.unshift("api-gateway");
for (const service of services) {
  if (action === "seed" && !JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", service, "package.json"))).scripts.seed) continue;
  console.log(`\n${service}: ${action}`);
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: path.resolve(__dirname, "..", service),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
if (action === "test") {
  const result = spawnSync(process.execPath, ["--test", path.resolve(__dirname, "..", "tests/service-flow.test.cjs")], { stdio: "inherit", windowsHide: true, env: process.env });
  process.exitCode = result.status || (result.error ? 1 : 0);
}
