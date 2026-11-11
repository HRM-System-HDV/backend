"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const database = require("../../src/config/database");
const WorkService = require("../../src/services/WorkService");

// Unit test chạy với prisma giả: không được chạm Postgres shared của môi trường dev.
function withFakePrisma(stub, fn) {
  const original = database.getPrisma;
  database.getPrisma = () => stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      database.getPrisma = original;
    });
}

function prismaError(code, message) {
  const err = new Error(message || `Prisma error ${code || "generic"}`);
  if (code) err.code = code;
  return err;
}

function baseStub(overrides = {}) {
  return {
    attendanceConfig: { findUnique: async () => ({ id: "default", earlyLeavePenaltyAmount: 15000 }) },
    shift: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => {
        throw new Error("shift.update không được gọi trong test này");
      },
    },
    ...overrides,
  };
}

test("checkout (Postgres): không có bản ghi mở -> lỗi thật, không tạo check-in hộ", async () => {
  const calls = { create: 0, update: 0, shiftUpdate: 0 };
  const stub = baseStub({
    shift: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => {
        calls.shiftUpdate += 1;
        return { id: "CA-0001" };
      },
    },
    attendance: {
      findMany: async () => [], // DB sống nhưng không còn bản ghi nào chưa chốt ra
      create: async () => {
        calls.create += 1;
        return { id: "att-phantom", checkIn: "08:00", checkOut: null };
      },
      update: async () => {
        calls.update += 1;
        return { id: "att-updated" };
      },
    },
  });

  await withFakePrisma(stub, async () => {
    let thrown = null;
    try {
      await WorkService.checkout({ employeeId: "u-emp-900", checkoutTime: "17:30" });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, "phải ném lỗi thật thay vì trả về bản ghi ảo");
    assert.equal(thrown.status, 404);
    assert.equal(thrown.code, "NOT_FOUND");
    assert.equal(calls.create, 0, "checkout không được tạo bản ghi chấm công mới");
    assert.equal(calls.update, 0, "không có dòng mở thì không được gọi update");
    assert.equal(calls.shiftUpdate, 0, "ca làm việc không bị đánh dấu hoàn thành khi chốt ra thất bại");
  });
});

test("checkout (Postgres): có bản ghi mở -> vẫn đồng bộ ca làm việc", async () => {
  const calls = { shiftUpdate: 0 };
  const stub = baseStub({
    shift: {
      findUnique: async () => ({ id: "CA-0001", date: "11/11/2026" }),
      findMany: async () => [],
      update: async ({ data }) => {
        calls.shiftUpdate += 1;
        return { id: "CA-0001", ...data };
      },
    },
    attendance: {
      findMany: async () => [{ id: "att-open", checkOut: null }],
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
  });

  await withFakePrisma(stub, async () => {
    await WorkService.checkout({ employeeId: "u-emp-903", shiftId: "CA-0001", checkoutTime: "18:00" });
    assert.equal(calls.shiftUpdate, 1, "syncShiftCheckout vẫn chạy khi chốt thành công");
  });
});

test("checkout (Postgres): có bản ghi mở -> vẫn update + tính phạt về sớm", async () => {
  const updates = [];
  const stub = baseStub({
    attendance: {
      findMany: async () => [{ id: "att-open", employeeId: "u-emp-901", checkOut: null }],
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
    },
  });

  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkout({ employeeId: "u-emp-901", checkoutTime: "16:00" });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, "att-open");
    assert.equal(updates[0].data.checkOut, "16:00");
    assert.equal(row.status, "early_leave");
    assert.equal(row.penaltyAmount, 15000);
  });
});

test("checkout (Postgres): lỗi đọc attendance ném lên 500, không rơi xuống memory", async () => {
  const stub = baseStub({
    attendance: {
      findMany: async () => {
        throw prismaError(null, "connection closed");
      },
    },
  });

  await withFakePrisma(stub, async () => {
    await assert.rejects(
      () => WorkService.checkout({ employeeId: "u-emp-902", checkoutTime: "17:30" }),
      /connection closed/
    );
  });
});

test("updateTask (Postgres): lỗi Prisma ném 500, P2025 mới là not-found", async () => {
  const stub = baseStub({
    task: {
      update: async () => {
        throw prismaError("P2002", "unique constraint");
      },
    },
  });

  await withFakePrisma(stub, async () => {
    // Lỗi ghi thật: phải propagate, không trả null (controller dịch null ra 404).
    await assert.rejects(() => WorkService.updateTask("CV-0001", { status: "done" }), /unique constraint/);
  });

  const notFoundStub = baseStub({
    task: {
      update: async () => {
        throw prismaError("P2025", "Record not found");
      },
    },
  });

  await withFakePrisma(notFoundStub, async () => {
    const row = await WorkService.updateTask("CV-KHONG-TON-TAI", { status: "done" });
    assert.equal(row, null, "thiếu dòng vẫn trả null để controller báo 404");
  });
});

test("deleteShift (Postgres): P2025 trả false, lỗi DB khác ném 500", async () => {
  const notFoundStub = baseStub({
    shift: {
      findUnique: async () => null,
      findMany: async () => [],
      delete: async () => {
        throw prismaError("P2025", "Record not found");
      },
    },
  });

  await withFakePrisma(notFoundStub, async () => {
    assert.equal(await WorkService.deleteShift("CA-9999"), false);
  });

  const dbDownStub = baseStub({
    shift: {
      findUnique: async () => null,
      findMany: async () => [],
      delete: async () => {
        throw prismaError(null, "connection terminated");
      },
    },
  });

  await withFakePrisma(dbDownStub, async () => {
    await assert.rejects(() => WorkService.deleteShift("CA-0001"), /connection terminated/);
  });
});

test("updateTemplate (Postgres): lỗi Prisma ném 500 thay vì trả null", async () => {
  const stub = baseStub({
    shiftTemplate: {
      update: async () => {
        throw prismaError(null, "deadlock detected");
      },
    },
  });

  await withFakePrisma(stub, async () => {
    await assert.rejects(() => WorkService.updateTemplate("st-1", { name: "Ca Dêm" }), /deadlock detected/);
  });
});
