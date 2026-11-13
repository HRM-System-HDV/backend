"use strict";
process.env.DATABASE_URL = "";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("supertest");
const db = require("../../src/config/database");
const clients = require("../../src/clients/ServiceClient");
const service = require("../../src/services/IntegrationService");
const app = require("../../src/app");
const getPrisma = db.getPrisma;
afterEach(() => { db.getPrisma = getPrisma; });

test("read-all marks only the signed-in employee's unread notifications, and is idempotent", async () => {
  const employeeId = randomUUID(), otherId = randomUUID();
  const admin = { userId: randomUUID(), role: "admin" };
  clients.employees = async () => [{ id: employeeId }, { id: otherId }];
  await service.sendNotification({ title: "First", body: "Body" }, admin);
  await service.sendNotification({ title: "Second", body: "Body" }, admin);
  const notifications = await service.listNotifications({ employeeId });
  await service.readNotification(notifications[0].id, { employeeId });
  const headers = { "x-user-id": randomUUID(), "x-user-role": "staff", "x-employee-id": employeeId };
  const response = await request(app).put("/api/notifications/read-all").set(headers).send({ employeeId: otherId });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { count: 1 });
  assert.ok((await service.listNotifications({ employeeId })).every(row => row.isRead));
  assert.ok((await service.listNotifications({ employeeId: otherId })).every(row => !row.isRead));
  const repeat = await request(app).put("/api/notifications/read-all").set(headers);
  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body.data, { count: 0 });
});

test("read-all requires authentication and does not update anything without an employee profile", async () => {
  assert.equal((await request(app).put("/api/notifications/read-all")).status, 401);
  db.getPrisma = () => { throw Error("Must not query DB without employeeId"); };
  assert.deepEqual(await service.readAllNotifications({ role: "admin", userId: randomUUID() }), { count: 0 });
});

test("Prisma read-all scopes the update itself to the current employee and unread rows", async () => {
  const employeeId = randomUUID();
  let calls = 0;
  db.getPrisma = () => ({ notification: { updateMany: async input => {
    calls++;
    assert.deepEqual(input, { where: { targetEmployeeId: employeeId, isRead: false }, data: { isRead: true } });
    return { count: 2 };
  } } });
  assert.deepEqual(await service.readAllNotifications({ employeeId }), { count: 2 });
  assert.equal(calls, 1);
});
