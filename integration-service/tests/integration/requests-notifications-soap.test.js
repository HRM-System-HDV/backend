"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("notifications CRUD + read", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const json = { "Content-Type": "application/json" };

  try {
    // Tạo 1 thông báo broadcast (không targetEmployeeId) rồi kiểm tra
    let res = await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "Thông báo chung", body: "Nội dung broadcast" }),
    });
    assert.equal(res.status, 201);

    // Broadcast luôn trả về cho mọi nhân viên
    res = await fetch(`${base}/api/notifications?employeeId=ai-do`);
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.some((n) => n.targetEmployeeId === null));

  // Thiếu body -> 400
  res = await fetch(`${base}/api/notifications`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: "x" }),
  });
  assert.equal(res.status, 400);

  res = await fetch(`${base}/api/notifications`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ targetEmployeeId: "e-x", title: "Chào", body: "Nội dung" }),
  });
  body = await res.json();
  assert.equal(res.status, 201);
  const id = body.data.id;

  res = await fetch(`${base}/api/notifications/${id}/read`, { method: "PUT" });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.isRead, true);

  res = await fetch(`${base}/api/notifications/${id}`, { method: "DELETE" });
  assert.equal(res.status, 200);

  } finally {
    server.close();
  }
});

test("notifications read-all + không lộ thông báo đích danh người khác", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const json = { "Content-Type": "application/json" };

  const createNotification = (payload) =>
    fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(payload),
    });

  try {
    await createNotification({ title: "Broadcast", body: "Chung" });
    await createNotification({ targetEmployeeId: "e-readall-a", title: "Của A", body: "Riêng A" });
    await createNotification({ targetEmployeeId: "e-readall-b", title: "Của B", body: "Riêng B" });

    // A chỉ thấy broadcast + thông báo của A, không thấy thông báo của B.
    let res = await fetch(`${base}/api/notifications?employeeId=e-readall-a`);
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.some((n) => n.title === "Của A"));
    assert.ok(body.data.every((n) => n.title !== "Của B"));

    // Thiếu employeeId/branchSlug -> 400, tránh đánh dấu đã đọc toàn hệ thống.
    res = await fetch(`${base}/api/notifications/read-all`, { method: "PUT" });
    assert.equal(res.status, 400);

    // Đọc tất cả trong phạm vi A.
    res = await fetch(`${base}/api/notifications/read-all?employeeId=e-readall-a`, {
      method: "PUT",
    });
    body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.updated >= 1);

    res = await fetch(`${base}/api/notifications?employeeId=e-readall-a`);
    body = await res.json();
    assert.ok(body.data.every((n) => n.isRead === true));

    // Thông báo của B vẫn chưa đọc.
    res = await fetch(`${base}/api/notifications?employeeId=e-readall-b`);
    body = await res.json();
    assert.ok(body.data.some((n) => n.title === "Của B" && n.isRead === false));
  } finally {
    server.close();
  }
});

test("SOAP WSDL + Fault khi thiếu trường", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  try {
    let res = await fetch(`${base}/soap/payroll?wsdl`);
  let text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("xml"));
  assert.ok(text.includes('name="PayoutRequest"'));

  // POST thiếu trường -> soap:Fault 400
  res = await fetch(`${base}/soap/payroll`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><PayoutRequest><content>x</content></PayoutRequest></soap:Body></soap:Envelope>`,
  });
  text = await res.text();
  assert.equal(res.status, 400);
  assert.ok(text.includes("<faultcode>soap:Client</faultcode>"));

  // POST XML rác -> soap:Fault
  res = await fetch(`${base}/soap/payroll`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: `<hello/>`,
  });
  text = await res.text();
  assert.ok(text.includes("soap:Fault"));

  } finally {
    server.close();
  }
});
