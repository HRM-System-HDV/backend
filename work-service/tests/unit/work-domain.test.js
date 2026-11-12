"use strict";
process.env.DATABASE_URL = "";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const service = require("../../src/services/WorkService");
const db = require("../../src/config/database");
const org = require("../../src/clients/OrgClient");
const integration = require("../../src/clients/IntegrationClient");
const clock = require("../../src/utils/time");
const admin = { userId: randomUUID(), role: "admin", name: "Quản trị" };
let people;
beforeEach((t) => {
  people = new Map();
  t.mock.method(db, "getPrisma", () => null);
  t.mock.method(org, "getEmployee", async (id) => { const e = people.get(id); if (!e) throw Object.assign(new Error("Không tìm thấy nhân viên"), { status: 404 }); return e; });
  t.mock.method(org, "listEmployees", async (branchId) => [...people.values()].filter((e) => !branchId || e.branchId === branchId));
  t.mock.method(integration, "getWifiConfigs", async (branchId) => [{ branchId, status: "hoạt động", bssid: "aa:bb:cc:dd:ee:ff", ssid: "HRM" }]);
  t.mock.method(integration, "writeBacklog", async () => ({ ok: true }));
  t.mock.method(integration, "deleteFileByUrl", async () => {});
});
function employee(overrides = {}) {
  const e = { id: randomUUID(), branchId: randomUUID(), name: "Nhân viên", salaryType: "hourly", salary: "30000", ...overrides };
  people.set(e.id, e); return e;
}
function staff(e) { return { role: "staff", userId: randomUUID(), employeeId: e.id, branchId: e.branchId }; }
const wifi = { bssid: "AA:BB:CC:DD:EE:FF", ssid: "HRM" };
async function fixture(t, opts = {}) {
  let instant = Date.parse("2026-11-01T00:00:00+07:00");
  t.mock.method(Date, "now", () => instant);
  const e = employee(opts.employee);
  const template = await service.createTemplate({ templateCode: randomUUID(), name: "Ca", startTime: opts.start || "07:00", endTime: opts.end || "12:00" }, admin);
  const shift = await service.createShift({ employeeId: e.id, templateId: template.id, workDate: "2026-11-12" }, admin);
  await service.updateConfig({ gracePeriodMinutes: 0, checkoutWindowMinutes: 60, latePenaltyPct: 10, earlyLeavePenaltyPct: 10, earlyCheckinMinutes: 15, allowDoubleCheckin: false, doubleCheckinEarlyMinutes: 0, doubleCheckinLateMinutes: 0 }, admin);
  return { e, actor: staff(e), template, shift, setTime: (iso) => { instant = Date.parse(iso); } };
}
test("date/overnight boundaries and invalid dates", () => {
  assert.throws(() => clock.date("2026-02-30"), /Ngày/);
  assert.throws(() => clock.date("bad"), /Ngày/);
  const b = clock.bounds({ workDate: "2026-11-12", scheduledStart: "22:00", scheduledEnd: "06:00" });
  assert.equal((b.end - b.start) / 3600000, 8);
});
test("concurrent duplicate assignment rejected; overlap rejected; adjacent ca permitted", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([1, 2].map(() => service.createShift({ employeeId: f.e.id, templateId: f.template.id, workDate: "2026-11-13" }, admin)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  const overlap = await service.createTemplate({ templateCode: randomUUID(), name: "Trùng giờ", startTime: "11:00", endTime: "14:00" }, admin);
  await assert.rejects(service.createShift({ employeeId: f.e.id, templateId: overlap.id, workDate: "2026-11-12" }, admin), { status: 409 });
  const adjacent = await service.createTemplate({ templateCode: randomUUID(), name: "Liền ca", startTime: "12:00", endTime: "17:00" }, admin);
  assert.ok((await service.createShift({ employeeId: f.e.id, templateId: adjacent.id, workDate: "2026-11-12" }, admin)).id);
});
test("Wi-Fi preflight fails before returning today shifts; employee id differs from user id", async (t) => {
  const f = await fixture(t); f.setTime("2026-11-12T07:00:00+07:00");
  await assert.rejects(service.preflight({ wifi: { bssid: "other" } }, f.actor), { status: 403 });
  const opened = await service.preflight({ wifi }, f.actor);
  assert.equal(opened.shifts.length, 1); assert.equal(opened.shifts[0].id, f.shift.id);
  await assert.rejects(service.preflight({ employeeId: randomUUID(), wifi }, f.actor), { status: 403 });
});
test("check-in too early rejected; late allowed and early checkout penalties sum against real hourly ca", async (t) => {
  const f = await fixture(t);
  f.setTime("2026-11-12T06:44:00+07:00");
  await assert.rejects(service.checkin({ shiftId: f.shift.id, wifi }, f.actor), /Chưa đến/);
  f.setTime("2026-11-12T07:01:00+07:00");
  assert.equal((await service.checkin({ shiftId: f.shift.id, wifi }, f.actor)).status, "late");
  await assert.rejects(service.checkin({ shiftId: f.shift.id, wifi }, f.actor), { status: 409 });
  let read = await service.listAttendance({ employeeId: f.e.id, month: "2026-11" }, f.actor);
  assert.equal(read[0].penaltyAmount, "0"); assert.equal(read[0].earnedSalary, "0");
  f.setTime("2026-11-12T11:01:00+07:00");
  const closed = await service.checkout({ shiftId: f.shift.id, wifi }, f.actor);
  assert.equal(closed.status, "late_early_leave"); assert.equal(closed.penaltyAmount, "24000");
  read = await service.listAttendance({ employeeId: f.e.id, month: "2026-11" }, f.actor);
  assert.equal(read[0].workedSeconds, 14400); assert.equal(read[0].earnedSalary, "120000");
});
test("checkout at deadline is blocked and old unclosed attendance does not block next ca", async (t) => {
  const f = await fixture(t);
  const template2 = await service.createTemplate({ templateCode: randomUUID(), name: "Sau", startTime: "13:00", endTime: "17:00" }, admin);
  const next = await service.createShift({ employeeId: f.e.id, templateId: template2.id, workDate: "2026-11-12" }, admin);
  f.setTime("2026-11-12T07:00:00+07:00"); await service.checkin({ shiftId: f.shift.id, wifi }, f.actor);
  f.setTime("2026-11-12T13:00:00+07:00");
  await assert.rejects(service.checkout({ shiftId: f.shift.id, wifi }, f.actor), /hết hạn/);
  assert.ok((await service.checkin({ shiftId: next.id, wifi }, f.actor)).checkIn);
  const rows = await service.listAttendance({ employeeId: f.e.id }, f.actor);
  assert.equal(rows.find((r) => r.shiftId === f.shift.id).checkOut, null);
  assert.equal(rows.find((r) => r.shiftId === f.shift.id).penaltyAmount, "0");
});
test("double attendance normalizes both join times and prevents duplicate writes", async (t) => {
  const f = await fixture(t);
  const template2 = await service.createTemplate({ templateCode: randomUUID(), name: "Trưa", startTime: "12:00", endTime: "17:00" }, admin);
  const next = await service.createShift({ employeeId: f.e.id, templateId: template2.id, workDate: "2026-11-12" }, admin);
  await service.updateConfig({ allowDoubleCheckin: true, doubleCheckinEarlyMinutes: 5, doubleCheckinLateMinutes: 5 }, admin);
  f.setTime("2026-11-12T07:00:00+07:00"); await service.checkin({ shiftId: f.shift.id, wifi }, f.actor);
  f.setTime("2026-11-12T11:58:00+07:00");
  const pair = await service.doubleAttendance({ shiftId: f.shift.id, nextShiftId: next.id, wifi }, f.actor);
  assert.equal(pair.previous.checkOut.toISOString(), "2026-11-12T05:00:00.000Z");
  assert.equal(pair.next.checkIn.toISOString(), pair.previous.checkOut.toISOString());
  assert.equal(pair.previous.penaltyAmount, "0"); assert.equal(pair.next.checkOut, null);
  await assert.rejects(service.doubleAttendance({ shiftId: f.shift.id, nextShiftId: next.id, wifi }, f.actor), { status: 409 });
  const list = await service.listAttendance({ employeeId: f.e.id }, f.actor);
  assert.equal(list.length, 2); assert.equal(list.find((r) => r.shiftId === next.id).earnedSalary, "0");
});
test("double attendance Postgres transaction rolls back previous checkout if next insert fails", async (t) => {
  const e = employee(); const previousId = randomUUID(), nextId = randomUUID();
  let store = {
    shift: [{ id: previousId, employeeId: e.id, workDate: new Date("2026-11-12"), scheduledStart: "07:00", scheduledEnd: "12:00", status: "đang làm" },
      { id: nextId, employeeId: e.id, workDate: new Date("2026-11-12"), scheduledStart: "12:00", scheduledEnd: "17:00", status: "đang làm" }],
    attendance: [{ id: randomUUID(), shiftId: previousId, employeeId: e.id, checkIn: new Date("2026-11-12T07:00:00+07:00"), checkOut: null }],
    attendanceConfig: [{ isSingleton: true, gracePeriodMinutes: 0, checkoutWindowMinutes: 60, allowDoubleCheckin: true, doubleCheckinEarlyMinutes: 5, doubleCheckinLateMinutes: 5, latePenaltyPct: 10, earlyLeavePenaltyPct: 10 }],
  };
  const fake = {};
  for (const model of Object.keys(store)) fake[model] = {
    findMany: async () => store[model], findUnique: async ({ where }) => store[model].find((r) => r.id === where.id),
    update: async ({ where, data }) => Object.assign(store[model].find((r) => r.id === where.id), data),
    create: async () => { throw new Error("insert failed"); },
  };
  let transactionOptions;
  fake.$transaction = async (fn, options) => { transactionOptions = options; const snapshot = structuredClone(store); try { return await fn(fake); } catch (error) { store = snapshot; throw error; } };
  t.mock.method(db, "getPrisma", () => fake); t.mock.method(Date, "now", () => Date.parse("2026-11-12T12:03:00+07:00"));
  await assert.rejects(service.doubleAttendance({ shiftId: previousId, nextShiftId: nextId, wifi }, staff(e)), /insert failed/);
  assert.equal(store.attendance[0].checkOut, null); assert.equal(store.attendance.length, 1); assert.equal(transactionOptions.isolationLevel, "Serializable");
});
test("overnight ca remains in preflight after midnight and can checkout", async (t) => {
  const f = await fixture(t, { start: "22:00", end: "06:00" });
  f.setTime("2026-11-12T22:00:00+07:00"); await service.checkin({ shiftId: f.shift.id, wifi }, f.actor);
  f.setTime("2026-11-13T01:00:00+07:00");
  assert.ok((await service.preflight({ wifi }, f.actor)).shifts.some((r) => r.id === f.shift.id));
  f.setTime("2026-11-13T06:00:00+07:00"); await service.checkout({ shiftId: f.shift.id, wifi }, f.actor);
  const attendance = (await service.listAttendance({ employeeId: f.e.id }, f.actor))[0];
  assert.equal(attendance.workedSeconds, 8 * 3600); assert.equal(attendance.penaltyAmount, "0");
});
test("manual admin times work after expiry, manager cannot cross branch, monthly wage recomputes current salary", async (t) => {
  const f = await fixture(t, { employee: { salaryType: "monthly", salary: "7800000", standardWorkDays: 26 } });
  f.setTime("2026-11-13T09:00:00+07:00");
  await assert.rejects(service.saveAttendance(f.shift.id, { checkIn: "2026-11-12T07:00:00+07:00", checkOut: "2026-11-12T12:00:00+07:00" }, { userId: randomUUID(), role: "manager", branchId: randomUUID() }), { status: 403 });
  await service.saveAttendance(f.shift.id, { checkIn: "2026-11-12T07:00:00+07:00", checkOut: "2026-11-12T12:00:00+07:00" }, admin);
  assert.equal((await service.listAttendance({ employeeId: f.e.id }, f.actor))[0].earnedSalary, "300000");
  f.e.salary = "10400000";
  assert.equal((await service.listAttendance({ employeeId: f.e.id }, f.actor))[0].earnedSalary, "400000");
});
test("common task shared completion only for assigned ca; personal task direct and isolated", async (t) => {
  const f = await fixture(t); const colleague = employee({ branchId: f.e.branchId }); const outsider = employee({ branchId: f.e.branchId });
  await service.createShift({ employeeId: colleague.id, templateId: f.template.id, workDate: "2026-11-12" }, admin);
  const shared = await service.createTask({ title: "Dọn chung", branchId: f.e.branchId, workDate: "2026-11-12", templateId: f.template.id, requirePhoto: true }, admin);
  await assert.rejects(service.updateTask(shared.id, { status: "done" }, f.actor), /minh chứng/);
  await assert.rejects(service.updateTask(shared.id, { status: "done", proofPhotoUrl: "http://image" }, staff(outsider)), { status: 403 });
  await service.updateTask(shared.id, { status: "done", proofPhotoUrl: "http://image" }, f.actor);
  assert.equal((await service.getTaskById(shared.id, staff(colleague))).status, "done");
  const personal = await service.createTask({ title: "Riêng", assignedTo: f.e.id }, admin);
  assert.ok((await service.listTasks({}, f.actor)).some((r) => r.id === personal.id));
  assert.ok(!(await service.listTasks({ workDate: "2026-11-12" }, f.actor)).some((r) => r.id === personal.id));
  await assert.rejects(service.updateTask(personal.id, { status: "done" }, staff(colleague)), { status: 403 });
});
test("configuration strict values and no write permissions for internal/read staff", async () => {
  await assert.rejects(service.updateConfig({ latePenaltyPct: 101 }, admin), { status: 400 });
  await assert.rejects(service.updateConfig({ latePenaltyAmount: 20000 }, admin), { status: 400 });
  await assert.rejects(service.getConfig({ userId: randomUUID(), role: "staff" }), { status: 403 });
  await assert.rejects(service.updateConfig({ latePenaltyPct: 1 }, { internal: true }), { status: 403 });
  await assert.rejects(service.updateConfig({ latePenaltyPct: 1 }, { internal: true, role: "admin", userId: randomUUID() }), { status: 403 });
});
