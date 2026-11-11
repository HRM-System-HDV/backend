"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const database = require("../../src/config/database");
const NotificationService = require("../../src/services/NotificationService");

// Unit test chạy ở chế độ memory + prisma giả: không được chạm Postgres dev.
function withMemory(fn) {
  const original = database.getPrisma;
  database.getPrisma = () => null;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      database.getPrisma = original;
    });
}

function withCapturingPrisma(fn) {
  const original = database.getPrisma;
  let where = null;
  database.getPrisma = () => ({
    notification: {
      findMany: async ({ where: w }) => {
        where = w;
        return [];
      },
    },
  });
  return Promise.resolve()
    .then(() => fn(() => where))
    .finally(() => {
      database.getPrisma = original;
    });
}

const titles = (rows) => rows.map((r) => r.title).sort().join(",");

test("phạm vi thông báo: nhân viên thường không thấy bản ghi phạm vi chi nhánh", async () => {
  await withMemory(async () => {
    await NotificationService.create({ title: "BC", body: "broadcast toàn hệ thống" });
    await NotificationService.create({ title: "BR", body: "thông báo dành cho quản lý chi nhánh", branchSlug: "HN-1" });
    await NotificationService.create({ title: "TG", body: "đích danh", targetEmployeeId: "NV-0003" });

    const staff = await NotificationService.findMany({ employeeId: "NV-0003", branchSlug: null });
    assert.equal(titles(staff).includes("BR"), false, "nhân viên không được đọc thông báo chứa danh tính người khác");
    assert.ok(titles(staff).includes("BC") && titles(staff).includes("TG"));

    const manager = await NotificationService.findMany({ employeeId: "NV-0002", branchSlug: "HN-1" });
    assert.ok(titles(manager).includes("BR"), "quản lý phải thấy thông báo ca bị bỏ qua của chi nhánh mình");

    const other = await NotificationService.findMany({ employeeId: "NV-0009", branchSlug: "CN-9" });
    assert.equal(titles(other).includes("BR"), false, "quản lý chi nhánh khác không được thấy");

    const admin = await NotificationService.findMany({ employeeId: "NV-0001", branchSlug: null, allBranches: true });
    assert.ok(titles(admin).includes("BR"), "admin xem chéo phải thấy thông báo của mọi chi nhánh");
  });
});

test("đường Prisma: allBranches phải được chuyển xuống where, không rơi ở chữ ký hàm", async () => {
  await withCapturingPrisma(async (getWhere) => {
    await NotificationService.findMany({ employeeId: "NV-0001", branchSlug: null, allBranches: true });
    const or = getWhere().OR;
    assert.ok(or.some((c) => c.targetEmployeeId === null && c.branchSlug && c.branchSlug.not === null),
      "phải có nhánh 'target null AND branchSlug not null' cho admin xem chéo");

    await NotificationService.findMany({ employeeId: "NV-0003", branchSlug: null });
    const staffOr = getWhere().OR;
    assert.equal(staffOr.some((c) => c.branchSlug && c.branchSlug.not === null), false,
      "nhân viên thường không được kéo theo bản ghi phạm vi chi nhánh");
  });
});
