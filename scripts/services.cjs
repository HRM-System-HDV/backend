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
// Lệnh `test` KHÔNG được dừng ở service đầu tiên fail: khi đó 5 suite còn lại
// không chạy và báo cáo mất bằng chứng. Chạy đủ, in tổng kết rồi mới thoát khác 0.
const continueOnFailure = action === "test";
const results = [];
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
  const status = result.status === null || result.status === undefined ? 1 : result.status;
  results.push({ label: service, status });
  if (status !== 0 && !continueOnFailure) process.exit(status || 1);
}
if (action === "test") {
  console.log("\nservice-flow: test");
  const result = spawnSync(process.execPath, ["--test", path.resolve(__dirname, "..", "tests/service-flow.test.cjs")], { stdio: "inherit", windowsHide: true, env: process.env });
  results.push({ label: "service-flow", status: result.status ?? (result.error ? 1 : 0) });
  const failed = results.filter((item) => item.status !== 0);
  console.log("\n=== Tổng kết theo service ===");
  for (const item of results) {
    console.log(`${item.status === 0 ? "[ OK ]" : "[FAIL]"} ${item.label} (exit ${item.status})`);
  }
  console.log(failed.length
    ? `Có ${failed.length} suite thất bại: ${failed.map((item) => item.label).join(", ")}.`
    : "Toàn bộ suite đạt.");
  process.exitCode = failed.length ? 1 : 0;
}
