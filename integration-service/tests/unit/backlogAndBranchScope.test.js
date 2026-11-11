"use strict";

process.env.DATABASE_URL = "";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

const database = require("../../src/config/database");
const BacklogService = require("../../src/services/BacklogService");
const { writeBranchSlug } = require("../../src/utils/branchScope");

function stubPrisma(methods) {
  const original = database.getPrisma;
  database.getPrisma = () => ({ $executeRaw: async () => 0, $queryRaw: async () => [], ...methods });
  return () => { database.getPrisma = original; };
}

describe("writeBranchSlug", () => {
  test("manager và staff bị ghim vào chi nhánh của token", () => {
    for (const role of ["manager", "staff"]) {
      const req = { headers: { "x-user-role": role, "x-branch-slug": "cn01" }, body: {} };
      assert.equal(writeBranchSlug(req, "cn02"), "cn01", `${role} không được chọn chi nhánh`);
    }
  });

  test("admin vẫn chọn được chi nhánh tường minh", () => {
    const req = { headers: { "x-user-role": "admin", "x-branch-slug": "cn01" }, body: {} };
    assert.equal(writeBranchSlug(req, "cn02"), "cn02");
    assert.equal(writeBranchSlug(req, undefined), "cn01");
  });
});

describe("BacklogService không bịa thành công khi Postgres lỗi", () => {
  test("create thất bại phải ném lỗi, không trả bản ghi ma", async () => {
    const restore = stubPrisma({
      backlog: {
        create: async () => { throw new Error("connect exploded"); },
      },
    });
    try {
      await assert.rejects(
        () => BacklogService.create({ action: "CREATE", module: "Test", targetName: "x" }),
        /Không ghi được nhật ký thao tác/
      );
    } finally {
      restore();
    }
  });

  test("list không được trả fixture khi query lỗi", async () => {
    const restore = stubPrisma({
      backlog: {
        findMany: async () => { throw new Error("connect exploded"); },
      },
    });
    try {
      await assert.rejects(() => BacklogService.list({}), /Không đọc được nhật ký thao tác/);
    } finally {
      restore();
    }
  });

  test("clear báo lỗi khi deleteMany lỗi", async () => {
    const restore = stubPrisma({
      backlog: {
        deleteMany: async () => { throw new Error("connect exploded"); },
      },
    });
    try {
      await assert.rejects(() => BacklogService.clear(), /Không xóa được nhật ký thao tác/);
    } finally {
      restore();
    }
  });

  test("memory mode (không có prisma) vẫn ghi và đọc được", async () => {
    const original = database.getPrisma;
    database.getPrisma = () => null;
    try {
      const row = await BacklogService.create({ action: "CREATE", module: "Test", targetName: "đối tượng" });
      assert.ok(row.id);
      const items = await BacklogService.list({});
      assert.ok(items.some((it) => it.id === row.id));
    } finally {
      database.getPrisma = original;
    }
  });
});
