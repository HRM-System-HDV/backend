"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("requests CRUD + duyệt tự sinh thông báo", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const json = { "Content-Type": "application/json" };

  try {
    // Danh sách khởi đầu là mảng (không phụ thuộc seed)
    let res = await fetch(`${base}/api/requests`);
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.data));

    // Tạo 1 yêu cầu tạm ứng để kiểm tra lọc theo type
    res = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ type: "advance", employeeId: "e-seed-1", title: "Tạm ứng", content: "việc riêng" }),
    });
    assert.equal(res.status, 201);

    // Lọc theo type
    res = await fetch(`${base}/api/requests?type=advance`);
    body = await res.json();
    assert.ok(body.data.every((r) => r.type === "advance"));
    assert.ok(body.data.length >= 1);

  // Tạo thiếu type -> 400
  res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ employeeId: "e-staff-1", title: "x", content: "y" }),
  });
  assert.equal(res.status, 400);

  // shift_swap thiếu shiftId -> 400
  res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ type: "shift_swap", employeeId: "e-staff-1", title: "Đổi ca", content: "doi" }),
  });
  assert.equal(res.status, 400);

  // Tạo yêu cầu nghỉ phép
  res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ type: "leave", employeeId: "e-staff-9", title: "Nghỉ phép", content: "việc gia đình" }),
  });
  body = await res.json();
  assert.equal(res.status, 201);
  const reqId = body.data.id;

  // Chi tiết
  res = await fetch(`${base}/api/requests/${reqId}`);
  assert.equal(res.status, 200);

  // Đếm thông báo của nhân viên trước duyệt
  res = await fetch(`${base}/api/notifications?employeeId=e-staff-9`);
  const before = (await res.json()).data.length;

  // Duyệt -> sinh thông báo
  res = await fetch(`${base}/api/requests/${reqId}/approve`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ reviewedBy: "e-mgr-hn1", reviewNote: "Đồng ý" }),
  });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.status, "approved");

  res = await fetch(`${base}/api/notifications?employeeId=e-staff-9`);
  const after = (await res.json()).data.length;
  assert.equal(after, before + 1);

  // Duyệt lần 2 -> 400 (không còn pending)
  res = await fetch(`${base}/api/requests/${reqId}/approve`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);

  // Xóa yêu cầu đã duyệt -> 400
  res = await fetch(`${base}/api/requests/${reqId}`, { method: "DELETE" });
  assert.equal(res.status, 400);

  // Từ chối 1 yêu cầu pending khác rồi xóa được
  res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ type: "overtime", employeeId: "e-staff-9", title: "Tăng ca", content: "cuối tháng" }),
  });
  const req2 = (await res.json()).data.id;
  res = await fetch(`${base}/api/requests/${req2}/reject`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ reviewedBy: "e-mgr-hn1" }),
  });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/requests/${req2}`, { method: "DELETE" });
  assert.equal(res.status, 400);

  } finally {
    server.close();
  }
});
