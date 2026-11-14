"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("shifts + attendance + tasks flow", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  // Dịch vụ tin danh tính do gateway truyền xuống; gọi thẳng phải tự gắn header.
  const asAdmin = { "Content-Type": "application/json", "x-user-role": "admin", "x-user-id": "admin-test" };

  // Config mặc định
  let res = await fetch(`${base}/api/attendance/config`);
  let body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.latePenaltyAmount, 20000);
  assert.equal(body.data.gracePeriodMinutes, 5);

  // Tạo ca
  res = await fetch(`${base}/api/shifts`, {
    method: "POST",
    headers: asAdmin,
    body: JSON.stringify({ employeeId: "e-staff-1", branchSlug: "HN-1", date: "02-10-2026", template: "Ca chiều", scheduledStart: "13:00", scheduledEnd: "17:00" }),
  });
  body = await res.json();
  assert.equal(res.status, 201);
  // Ngày ca luôn được chuẩn hóa DD/MM/YYYY dù client gửi dạng gạch ngang.
  assert.equal(body.data?.date, "02/10/2026");
  const createdShiftId = body.data?.id;

  // Thiếu date -> 400
  res = await fetch(`${base}/api/shifts`, {
    method: "POST",
    headers: asAdmin,
    body: JSON.stringify({ employeeId: "e-staff-1" }),
  });
  assert.equal(res.status, 400);

  // Nhân viên không được chấm công thay người khác.
  res = await fetch(`${base}/api/attendance/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-role": "staff", "x-user-id": "e-staff-2" },
    body: JSON.stringify({ employeeId: "e-staff-1" }),
  });
  assert.equal(res.status, 403);

  // Checkin + checkout + history
  res = await fetch(`${base}/api/attendance/checkin`, {
    method: "POST",
    headers: asAdmin,
    body: JSON.stringify({ employeeId: "e-staff-1" }),
  });
  assert.equal(res.status, 201);

  res = await fetch(`${base}/api/attendance/checkout`, {
    method: "POST",
    headers: asAdmin,
    body: JSON.stringify({ employeeId: "e-staff-1", time: "17:30" }),
  });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(typeof body.data.penaltyAmount === "number");

  res = await fetch(`${base}/api/attendance?employeeId=e-staff-1`, { headers: asAdmin });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.data));

  // Tasks CRUD + filter
  res = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: asAdmin,
    body: JSON.stringify({ title: "Dọn kho", assignedTo: "e-staff-1", branchSlug: "HN-1" }),
  });
  const created = await res.json();
  assert.equal(res.status, 201);

  res = await fetch(`${base}/api/tasks?branchSlug=HN-1&status=pending`, { headers: asAdmin });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.data.length >= 1);

  // Update + delete task
  res = await fetch(`${base}/api/tasks/${created.data.id}`, {
    method: "PUT",
    headers: asAdmin,
    body: JSON.stringify({ status: "done" }),
  });
  assert.equal(res.status, 200);

  res = await fetch(`${base}/api/tasks/${created.data.id}`, {
    method: "DELETE",
    headers: asAdmin,
  });
  assert.equal(res.status, 200);

  if (createdShiftId) {
    await fetch(`${base}/api/shifts/${createdShiftId}`, { method: "DELETE", headers: asAdmin });
  }

  // server.close() một mình sẽ treo với kết nối keep-alive còn mở.
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
