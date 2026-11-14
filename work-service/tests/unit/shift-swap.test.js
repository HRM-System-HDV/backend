"use strict";
process.env.DATABASE_URL = "";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const service = require("../../src/services/WorkService");
const db = require("../../src/config/database");
const org = require("../../src/clients/OrgClient");
const integration = require("../../src/clients/IntegrationClient");
const admin = { userId: randomUUID(), role: "admin", name: "Quản trị" };
// integration-service gọi bằng x-internal-token; người phản hồi đơn có thể là nhân viên.
const internal = { internal: true, name: "Integration" };
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

function employee(branchId) {
  const e = { id: randomUUID(), branchId, name: "Nhân viên", salaryType: "hourly", salary: "30000", status: "đang làm" };
  people.set(e.id, e); return e;
}
async function fixture(t, { start = "07:00", end = "12:00", workDate = "2026-11-12" } = {}) {
  let instant = Date.parse("2026-11-01T00:00:00+07:00");
  t.mock.method(Date, "now", () => instant);
  const branchA = randomUUID();
  const a = employee(branchA); const b = employee(branchA);
  await service.updateConfig({ gracePeriodMinutes: 0, checkoutWindowMinutes: 60, latePenaltyPct: 10, earlyLeavePenaltyPct: 10, earlyCheckinMinutes: 15, allowDoubleCheckin: false, doubleCheckinEarlyMinutes: 0, doubleCheckinLateMinutes: 0 }, admin);
  const morning = await service.createTemplate({ templateCode: randomUUID(), name: "Sáng", startTime: start, endTime: end }, admin);
  const evening = await service.createTemplate({ templateCode: randomUUID(), name: "Chiều", startTime: "13:00", endTime: "18:00" }, admin);
  const shiftA = await service.createShift({ employeeId: a.id, branchId: branchA, templateId: morning.id, workDate }, admin);
  const shiftB = await service.createShift({ employeeId: b.id, branchId: branchA, templateId: evening.id, workDate }, admin);
  return { branchA, a, b, shiftA, shiftB, setTime: (iso) => { instant = Date.parse(iso); } };
}

test("duyệt đơn đổi ca hoán đổi HAI chiều trên lịch phân ca", async (t) => {
  const f = await fixture(t);
  const result = await service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, internal);
  assert.equal(result.source.employeeId, f.b.id);
  assert.equal(result.target.employeeId, f.a.id);
  const shifts = await service.listShifts({}, admin);
  assert.deepEqual(shifts.find((s) => s.id === f.shiftA.id).employeeId, f.b.id);
  assert.deepEqual(shifts.find((s) => s.id === f.shiftB.id).employeeId, f.a.id);
});

test("nhờ làm thay (không có ca đích) chỉ chuyển ca nguồn sang người được nhờ", async (t) => {
  const f = await fixture(t);
  const result = await service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: null, targetEmployeeId: f.b.id }, internal);
  assert.equal(result.source.employeeId, f.b.id);
  assert.equal(result.target, null);
  assert.equal((await service.listShifts({}, admin)).find((s) => s.id === f.shiftB.id).employeeId, f.b.id, "ca của người được nhờ vẫn giữ nguyên");
});

test("client không được gọi nội bộ hoán đổi ca", async (t) => {
  const f = await fixture(t);
  for (const caller of [admin, { userId: randomUUID(), role: "manager", branchId: f.branchA }]) {
    await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, caller), /nội bộ/i);
  }
});

test("ca đã tới giờ thì chặn hoán đổi, lịch không đổi", async (t) => {
  const f = await fixture(t);
  f.setTime("2026-11-12T07:30:00+07:00");
  await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, internal), /chưa đến giờ/);
  const shifts = await service.listShifts({}, admin);
  assert.equal(shifts.find((s) => s.id === f.shiftA.id).employeeId, f.a.id);
  assert.equal(shifts.find((s) => s.id === f.shiftB.id).employeeId, f.b.id);
});

test("ca đã chấm công thì chặn hoán đổi kể cả khi còn trước giờ bắt đầu", async (t) => {
  const f = await fixture(t);
  f.setTime("2026-11-12T07:30:00+07:00");
  await service.checkin({ shiftId: f.shiftA.id, employeeId: f.a.id, wifi: { bssid: "aa:bb:cc:dd:ee:ff", ssid: "HRM" } }, { userId: randomUUID(), role: "staff", employeeId: f.a.id, branchId: f.branchA });
  f.setTime("2026-11-12T06:00:00+07:00");
  await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, internal), /chưa đến giờ và chưa chấm công/);
  assert.equal((await service.listShifts({}, admin)).find((s) => s.id === f.shiftA.id).employeeId, f.a.id);
});

test("ca đích không thuộc nhân viên được nhờ thì từ chối", async (t) => {
  const f = await fixture(t);
  const outsider = employee(randomUUID());
  await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: outsider.id }, internal), /không thuộc nhân viên/);
});

test("nhân viên được nhờ đã nghỉ việc thì chặn hoán đổi", async (t) => {
  const f = await fixture(t);
  people.set(f.b.id, { ...f.b, status: "nghỉ việc" });
  await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, internal), /nghỉ việc/);
});

test("ca và nhân viên được nhờ khác chi nhánh thì chặn", async (t) => {
  const f = await fixture(t);
  const otherBranch = randomUUID();
  people.set(f.b.id, { ...f.b, branchId: otherBranch });
  await assert.rejects(service.swapShiftEmployees({ sourceShiftId: f.shiftA.id, targetShiftId: f.shiftB.id, targetEmployeeId: f.b.id }, internal), /cùng chi nhánh/);
});
