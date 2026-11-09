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

  // Đếm thông báo đích danh của nhân viên trước duyệt.
  // Bỏ qua broadcast vì file test khác chạy song song có thể tạo thêm.
  const countTargeted = (list) => list.filter((n) => n.targetEmployeeId === "e-staff-9").length;
  res = await fetch(`${base}/api/notifications?employeeId=e-staff-9`);
  const before = countTargeted((await res.json()).data);

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
  const after = countTargeted((await res.json()).data);
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

test("nhờ làm thay: thông báo mang requestId và chỉ người nhận được phản hồi", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const base = `http://localhost:${server.address().port}`;
  const json = { "Content-Type": "application/json" };
  const sender = "e-cover-sender";
  const target = "e-cover-target";

  try {
    let res = await fetch(`${base}/api/requests`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        type: "overtime",
        employeeId: sender,
        targetEmployeeId: target,
        branchSlug: "CN01",
        title: "Nhờ làm thay: Ca sáng",
        content: "Nhờ bạn làm thay ca sáng",
        notification: {
          requestType: "cover",
          shiftName: "Ca sáng",
          shiftDate: "09/11/2026",
          shiftTime: "08:00 - 12:00",
          branch: "CN01",
          senderName: "Người gửi",
        },
      }),
    });
    const reqBody = await res.json();
    assert.equal(res.status, 201);
    const requestId = reqBody.data.id;
    assert.equal(reqBody.data.targetEmployeeId, target);

    // Thông báo cho người được nhờ phải mang metadata.requestId = id đơn thật.
    res = await fetch(`${base}/api/notifications?employeeId=${target}`);
    const notifs = (await res.json()).data;
    const notif = notifs.find((n) => n.metadata && n.metadata.requestId === requestId);
    assert.ok(notif, "phải có thông báo gắn requestId");
    assert.equal(notif.requestType, "cover");
    assert.equal(notif.metadata.requestStatus, "pending");

    // Người khác không được phản hồi
    res = await fetch(`${base}/api/requests/${requestId}/respond`, {
      method: "PUT",
      headers: { ...json, "x-user-id": "e-cover-other" },
      body: JSON.stringify({ accept: true }),
    });
    assert.equal(res.status, 403);

    // Đúng người nhận thì chấp nhận được
    res = await fetch(`${base}/api/requests/${requestId}/respond`, {
      method: "PUT",
      headers: { ...json, "x-user-id": target },
      body: JSON.stringify({ accept: true }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.status, "approved");

    // Người gửi nhận thông báo kết quả
    res = await fetch(`${base}/api/notifications?employeeId=${sender}`);
    const senderNotifs = (await res.json()).data;
    assert.ok(senderNotifs.some((n) => n.metadata && n.metadata.requestId === requestId
      && n.metadata.requestStatus === "approved"));

    // Dọn thông báo test
    for (const n of [notif, ...senderNotifs.filter((x) => x.metadata && x.metadata.requestId === requestId)]) {
      await fetch(`${base}/api/notifications/${n.id}`, { method: "DELETE" });
    }
    await fetch(`${base}/api/requests/${requestId}`, { method: "DELETE" });
  } finally {
    server.close();
  }
});
