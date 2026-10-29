"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("shifts + attendance + tasks flow", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  // Config mặc định
  let res = await fetch(`${base}/api/attendance/config`);
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.latePenaltyAmount, 20000);
  assert.equal(body.data.gracePeriodMinutes, 5);

  // Tạo ca
  res = await fetch(`${base}/api/shifts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "e-staff-1", branchSlug: "HN-1", date: "02-10-2026", template: "Ca chiều", scheduledStart: "13:00", scheduledEnd: "17:00" }),
  });
  body = await res.json();
  assert.equal(res.status, 201);

  // Thiếu date -> 400
  res = await fetch(`${base}/api/shifts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "e-staff-1" }),
  });
  assert.equal(res.status, 400);

  // Checkin + checkout + history
  res = await fetch(`${base}/api/attendance/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "e-staff-1" }),
  });
  assert.equal(res.status, 201);

  res = await fetch(`${base}/api/attendance/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "e-staff-1", time: "17:30" }),
  });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(typeof body.data.penaltyAmount === "number");

  res = await fetch(`${base}/api/attendance?employeeId=e-staff-1`);
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.data));

  // Tasks CRUD + filter
  res = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Dọn kho", assignedTo: "e-staff-1", branchSlug: "HN-1" }),
  });
  const created = await res.json();
  assert.equal(res.status, 201);

  res = await fetch(`${base}/api/tasks?branchSlug=HN-1&status=pending`);
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.data.length >= 1);

  // Update + delete task
  res = await fetch(`${base}/api/tasks/${created.data.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" }),
  });
  assert.equal(res.status, 200);

  server.close();
});
