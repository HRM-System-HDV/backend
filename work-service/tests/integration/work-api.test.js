"use strict";
process.env.DATABASE_URL = "";
process.env.INTERNAL_API_TOKEN = "work-test-internal";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { randomUUID } = require("node:crypto");
const app = require("../../src/app");
test("health works without auth; anonymous work requests denied with 401 and archive gone", async () => {
  assert.equal((await request(app).get("/health")).status, 200);
  // Q-A-05: chưa xác thực => 401 UNAUTHORIZED (đã xác thực nhưng thiếu quyền mới là 403).
  assert.equal((await request(app).get("/api/shifts")).status, 401);
  assert.equal((await request(app).post("/api/attendance/checkin").send({ shiftId: randomUUID() })).status, 401);
  assert.equal((await request(app).get("/api/archive/work/tasks")).status, 404);
});
test("internal read config allowed; staff reads own branch; internal mutations blocked", async () => {
  const read = await request(app).get("/api/attendance/config").set("x-internal-token", "work-test-internal");
  assert.equal(read.status, 200); assert.equal(read.body.data.checkoutWindowMinutes, 60);
  assert.equal(read.body.data.allowDoubleCheckin, false);
  const staff = { "x-user-id": randomUUID(), "x-employee-id": randomUUID(), "x-user-role": "staff" };
  // Staff chỉ ĐỌC (cấu hình mặc định khi không có chi nhánh), không ghi.
  assert.equal((await request(app).get("/api/attendance/config").set(staff)).status, 200);
  assert.equal((await request(app).put("/api/attendance/config").set(staff).send({ gracePeriodMinutes: 1 })).status, 403);
  assert.equal((await request(app).put("/api/attendance/config").set("x-internal-token", "work-test-internal").send({ latePenaltyPct: 1 })).status, 403);
});
test("manager edits own branch config only", async () => {
  const branchA = randomUUID(); const branchB = randomUUID();
  const managerA = { "x-user-id": randomUUID(), "x-user-role": "manager", "x-branch-id": branchA };
  assert.equal((await request(app).put("/api/attendance/config").set(managerA).send({ gracePeriodMinutes: 7 })).status, 200);
  assert.equal((await request(app).get("/api/attendance/config").set(managerA)).body.data.branchId, branchA);
  assert.equal((await request(app).get("/api/attendance/config").set(managerA).query({ branchId: branchB })).status, 403);
  assert.equal((await request(app).put("/api/attendance/config").set(managerA).query({ branchId: branchB }).send({ gracePeriodMinutes: 3 })).status, 403);
  // Admin không truyền branchId -> vẫn thấy row mặc định, không bị ghi đè bởi cấu hình chi nhánh A.
  const admin = { "x-user-id": randomUUID(), "x-user-role": "admin" };
  const system = await request(app).get("/api/attendance/config").set(admin);
  assert.equal(system.status, 200); assert.equal(system.body.data.gracePeriodMinutes, 0);
  assert.equal((await request(app).get("/api/attendance/config").set(admin).query({ branchId: branchA })).body.data.gracePeriodMinutes, 7);
});
test("admin can configure new fields; deprecated payload rejected", async () => {
  const actor = { "x-user-id": randomUUID(), "x-user-role": "admin" };
  assert.equal((await request(app).put("/api/attendance/config").set(actor).send({ allowDoubleCheckin: true, doubleCheckinEarlyMinutes: 5, doubleCheckinLateMinutes: 5 })).status, 200);
  assert.equal((await request(app).put("/api/attendance/config").set(actor).send({ autoCloseShift: true })).status, 400);
});

test("public task deadline round-trips hours and minutes without date-only conversion", async (t) => {
  const org = require("../../src/clients/OrgClient");
  const employee = { id: randomUUID(), branchId: randomUUID() };
  t.mock.method(org, "getEmployee", async () => employee);
  const actor = { "x-user-id": randomUUID(), "x-user-role": "admin" };
  const created = await request(app).post("/api/tasks").set(actor).send({ title: "Timed task", assignedTo: employee.id, dueDate: "2026-11-15T17:30:00+07:00" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.dueDate, "2026-11-15T10:30:00.000Z");
  const listed = await request(app).get("/api/tasks").set(actor);
  assert.equal(listed.body.data.find((task) => task.id === created.body.data.id).dueDate, created.body.data.dueDate);
  const updated = await request(app).put(`/api/tasks/${created.body.data.id}`).set(actor).send({ status: "done" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.dueDate, created.body.data.dueDate);
});

test("preflight endpoint is removed", async () => {
  await request(app).post("/api/attendance/preflight").set({"x-user-id":randomUUID(),"x-user-role":"admin"}).send({}).expect(404);
});
