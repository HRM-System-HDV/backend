"use strict";

// Bổ sung chi nhánh cho phiếu lương đã tạo trước khi có cột `branchSlug`.
// Quản lý được ghim theo chi nhánh nên phiếu cũ thiếu chi nhánh sẽ không hiện
// với quản lý cho tới khi chạy script này.
//
// Chạy:  node scripts/backfill-payslip-branch.js
// Cần:   DATABASE_URL (Postgres) và ORGANIZATION_URL đang chạy.

const database = require("../src/config/database");
const OrgClient = require("../src/clients/OrgClient");

async function main() {
  const prisma = database.getPrisma();
  if (!prisma) {
    console.error("Cần DATABASE_URL trỏ tới Postgres để chạy backfill.");
    process.exit(1);
  }

  const rows = await prisma.payslip.findMany({
    where: { OR: [{ branchSlug: null }, { branchSlug: "" }] },
    select: { id: true, employeeId: true },
  });
  console.log(`Phiếu lương thiếu chi nhánh: ${rows.length}`);

  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const emp = await OrgClient.getEmployeeById(row.employeeId);
      if (!emp || !emp.branchSlug) {
        failed += 1;
        continue;
      }
      await prisma.payslip.update({ where: { id: row.id }, data: { branchSlug: emp.branchSlug } });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`- ${row.id} (${row.employeeId}): ${err.message}`);
    }
  }

  console.log(`Đã cập nhật: ${updated}, bỏ qua: ${failed}`);
}

main()
  .catch((err) => {
    console.error("Backfill thất bại:", err.message);
    process.exit(1);
  })
  .finally(() => database.disconnect && database.disconnect());
