"use strict";
require("dotenv").config();
const bcrypt = require("bcryptjs");
async function main() {
  const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email.includes("@") || !password || password.length < 8) throw new Error("Cần SEED_ADMIN_EMAIL và SEED_ADMIN_PASSWORD tối thiểu 8 ký tự để tạo admin");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: process.env.SEED_ADMIN_NAME || "Quản trị viên", systemRole: "admin", passwordHash: await bcrypt.hash(password, 10) } });
    console.log("Đã tạo admin nếu chưa tồn tại; không thay đổi tài khoản có sẵn");
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
