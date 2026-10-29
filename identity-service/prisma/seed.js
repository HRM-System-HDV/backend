"use strict";

const bcrypt = require("bcryptjs");

// Seed dùng khi DATABASE_URL Postgres khả dụng: node prisma/seed.js
// Không commit .env thật. Chạy: DATABASE_URL=... node prisma/seed.js
async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const seeds = [
    { id: "NV-0001", email: "admin@company.com", name: "Trần Minh Tuấn", role: "admin", roleTitle: "Quản trị viên", branchSlug: null },
    { id: "NV-0002", email: "manager@company.com", name: "Vũ Thành Công", role: "manager", roleTitle: "Quản lý Chi nhánh", branchSlug: "HN-1" },
    { id: "NV-0003", email: "nhanvien@company.com", name: "Nguyễn Thu Hà", role: "staff", roleTitle: "Nhân viên", branchSlug: "HN-1" },
  ];
  // Không xoá tài khoản khác khi seed: giữ nguyên dữ liệu thật trong DB.
  for (const s of seeds) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, passwordHash: bcrypt.hashSync("123456", 10) },
    });
  }
  console.log("Seed xong tài khoản admin mặc định (không xoá tài khoản khác)");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
