"use strict";
process.env.DATABASE_URL = "";
process.env.INTERNAL_API_TOKEN = "work-test-internal";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { randomUUID } = require("node:crypto");
const app = require("../../src/app");
test("health works without auth; anonymous work requests denied and archive gone", async () => {
  assert.equal((await request(app).get("/health")).status, 200);
  assert.equal((await request(app).get("/api/shifts")).status, 403);
  assert.equal((await request(app).post("/api/attendance/checkin").send({ shiftId: randomUUID() })).status, 403);
  assert.equal((await request(app).get("/api/archive/work/tasks")).status, 404);
});
test("internal read config allowed; staff and internal mutations blocked", async () => {
  const read = await request(app).get("/api/attendance/config").set("x-internal-token", "work-test-internal");
  assert.equal(read.status, 200); assert.equal(read.body.data.checkoutWindowMinutes, 60);
  assert.equal(read.body.data.allowDoubleCheckin, false);
  const staff = { "x-user-id": randomUUID(), "x-employee-id": randomUUID(), "x-user-role": "staff" };
  assert.equal((await request(app).get("/api/attendance/config").set(staff)).status, 403);
  assert.equal((await request(app).put("/api/attendance/config").set("x-internal-token", "work-test-internal").send({ latePenaltyPct: 1 })).status, 403);
});
test("admin can configure new fields; deprecated payload rejected", async () => {
  const actor = { "x-user-id": randomUUID(), "x-user-role": "admin" };
  assert.equal((await request(app).put("/api/attendance/config").set(actor).send({ allowDoubleCheckin: true, doubleCheckinEarlyMinutes: 5, doubleCheckinLateMinutes: 5 })).status, 200);
  assert.equal((await request(app).put("/api/attendance/config").set(actor).send({ autoCloseShift: true })).status, 400);
});
