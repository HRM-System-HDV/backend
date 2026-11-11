"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const database = require("../../src/config/database");
const WorkService = require("../../src/services/WorkService");

// Toàn bộ test chạy với prisma giả: không chạm Postgres shared của môi trường dev.
const CFG = {
  id: "default",
  latePenaltyAmount: 20000,
  earlyLeavePenaltyAmount: 15000,
  gracePeriodMinutes: 5,
};

function withFakePrisma(stub, fn) {
  const original = database.getPrisma;
  database.getPrisma = () => stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      database.getPrisma = original;
    });
}

function stubWithShift(scheduledStart, overrides = {}) {
  const created = [];
  const stub = {
    attendanceConfig: { findUnique: async () => CFG },
    shift: {
      findUnique: async () => ({ id: "CA-1", scheduledStart, date: "11/11/2026" }),
      findMany: async () => [],
      update: async ({ data }) => ({ id: "CA-1", ...data }),
    },
    attendance: {
      create: async ({ data }) => {
        created.push(data);
        return { id: `att-${created.length}`, ...data };
      },
    },
    ...overrides,
  };
  return { stub, created };
}

test("checkin: trễ hơn ca + thời gian cho phép -> phạt latePenaltyAmount, nhãn late", async () => {
  const { stub, created } = stubWithShift("08:00");
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkin({ employeeId: "u-emp-late", shiftId: "CA-1", checkinTime: "08:30" });
    assert.equal(row.status, "late");
    assert.equal(row.penaltyAmount, 20000);
    assert.equal(created[0].penaltyNote, "Đi muộn 25 phút so với ca 08:00");
  });
});

test("checkin: trong gracePeriodMinutes -> không phạt", async () => {
  const { stub, created } = stubWithShift("08:00");
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkin({ employeeId: "u-emp-ok", shiftId: "CA-1", checkinTime: "08:05" });
    assert.equal(row.status, "present");
    assert.equal(row.penaltyAmount, 0);
    assert.equal(created[0].penaltyNote, null);
  });
});

test("checkin: không tìm được ca trong ngày -> không bịa giờ chuẩn, không phạt", async () => {
  const { stub, created } = stubWithShift("08:00", {
    shift: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => ({}),
    },
  });
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkin({ employeeId: "u-emp-noshift", checkinTime: "11:00" });
    assert.equal(row.status, "present");
    assert.equal(row.penaltyAmount, 0);
    assert.equal(created.length, 1);
  });
});

test("checkin: ca thiếu scheduledStart -> không phạt", async () => {
  const { stub } = stubWithShift(null);
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkin({ employeeId: "u-emp-nostart", shiftId: "CA-1", checkinTime: "11:00" });
    assert.equal(row.status, "present");
    assert.equal(row.penaltyAmount, 0);
  });
});

test("checkout: không xoá phần phạt đi muộn đã ghi khi chấm công", async () => {
  const open = { id: "att-open", employeeId: "u-emp-both", checkOut: null, penaltyAmount: 20000, status: "late" };
  const updates = [];
  const stub = {
    attendanceConfig: { findUnique: async () => CFG },
    shift: {
      findUnique: async () => ({ id: "CA-1", scheduledStart: "08:00", date: "11/11/2026" }),
      findMany: async () => [],
      update: async ({ data }) => ({ id: "CA-1", ...data }),
    },
    attendance: {
      findMany: async () => [open],
      update: async ({ where, data }) => {
        updates.push(data);
        return { id: where.id, ...open, ...data };
      },
    },
  };

  // Vừa trễ vừa về sớm: cộng dồn hai khoản, nhãn ưu tiên early_leave.
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkout({ employeeId: "u-emp-both", shiftId: "CA-1", checkoutTime: "16:00" });
    assert.equal(updates.length, 1);
    assert.equal(row.penaltyAmount, 35000);
    assert.equal(row.status, "early_leave");
  });

  updates.length = 0;
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkout({ employeeId: "u-emp-both", shiftId: "CA-1", checkoutTime: "17:30" });
    assert.equal(row.penaltyAmount, 20000, "đúng giờ ra thì phần phạt đi muộn vẫn còn");
    assert.equal(row.status, "late", "status không bị ghi đè thành present khi đã late");
  });
});
