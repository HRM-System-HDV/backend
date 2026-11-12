"use strict";
// Nạp hồ sơ chuẩn từ file do người vận hành cung cấp; không tự tạo dữ liệu lúc boot.
const fs = require("node:fs");
const database = require("../src/config/database");
const OrgService = require("../src/services/OrgService");
async function ensureSeeded() {
  if (!process.env.ORG_SEED_FILE) throw new Error("Cần ORG_SEED_FILE trỏ tới file JSON chứa mảng hồ sơ Employee theo schema mới");
  const employees = JSON.parse(fs.readFileSync(process.env.ORG_SEED_FILE,"utf8"));
  if (!Array.isArray(employees)) throw new Error("File seed phải chứa mảng Employee");
  const caller = {userId:"seed",role:"admin"};
  let created = 0;
  for (const employee of employees) {
    const existing = await OrgService.listEmployees({email:employee.email},caller);
    if (!existing.length) {await OrgService.createEmployee(employee,caller);created++;}
  }
  return {created};
}
if (require.main === module) {
  if (!process.env.DATABASE_URL) {console.error("Cần DATABASE_URL để seed; không seed vào bộ nhớ tạm");process.exitCode=1;}
  else database.connect().then(ensureSeeded).then(console.log).catch(error => {console.error(error.message);process.exitCode=1;}).finally(database.disconnect);
}
module.exports = {ensureSeeded};