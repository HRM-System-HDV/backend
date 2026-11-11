"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateShift, validateTask } = require("../../src/validators/workValidator");
const { toVnDate, toVnDateTime, dateKey, monthKey } = require("../../src/utils/dateFormat");
const WorkService = require("../../src/services/WorkService");

test("validateShift + validateTask", () => {
  assert.ok(validateShift({}).length > 0);
  assert.deepEqual(validateShift({ employeeId: "e-1", date: "02/10/2026" }), []);
  assert.ok(validateTask({}).length > 0);
  assert.deepEqual(validateTask({ title: "Việc" }), []);
});

test("WorkService checkin & checkout support checkinTime and checkoutTime", async () => {
  const ci1 = await WorkService.checkin({ employeeId: "u-emp-1", checkinTime: "08:30" });
  assert.equal(ci1.checkIn, "08:30");

  const co1 = await WorkService.checkout({ employeeId: "u-emp-1", checkoutTime: "17:35" });
  assert.equal(co1.checkOut, "17:35");

  const ci2 = await WorkService.checkin({ employeeId: "u-emp-2", time: "09:15", checkinTime: "08:30" });
  assert.equal(ci2.checkIn, "09:15");

  const co2 = await WorkService.checkout({ employeeId: "u-emp-2", time: "18:15", checkoutTime: "17:35" });
  assert.equal(co2.checkOut, "18:15");
});

test("dateFormat chuẩn hóa mọi định dạng về DD/MM/YYYY", () => {
  assert.equal(toVnDate("2026-10-02"), "02/10/2026");
  assert.equal(toVnDate("02-10-2026"), "02/10/2026");
  assert.equal(toVnDate("2/10/2026"), "02/10/2026");
  assert.equal(toVnDateTime("2026-10-02T14:05:00"), "02/10/2026 14:05");
  assert.equal(toVnDateTime("02/10/2026"), "02/10/2026");
  assert.equal(toVnDate("T2"), null);
  assert.equal(dateKey("02/10/2026"), "20261002");
  assert.deepEqual(monthKey("2026-10"), { yy: "2026", mon: "10" });
  assert.deepEqual(monthKey("10/2026"), { yy: "2026", mon: "10" });
});
