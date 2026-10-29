"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("CRUD branches + departments + employees validation", async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const suffix = `${Date.now()}`;

  try {
    // Branches: khởi đầu là mảng (không phụ thuộc seed)
    let res = await fetch(`${base}/api/branches`);
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.data));

    // Tạo chi nhánh mới qua API (mã CN-xxxx do hệ thống tự sinh)
    res = await fetch(`${base}/api/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Chi nhánh ${suffix}` }),
    });
    body = await res.json();
    assert.equal(res.status, 201);
    const branchSlug = body.data.slug;
    assert.ok(/^CN-\d{4}$/.test(branchSlug));

    // Danh sách phải chứa chi nhánh vừa tạo
    res = await fetch(`${base}/api/branches`);
    body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.length >= 1);
    assert.ok(body.data.some((b) => b.slug === branchSlug));

    // Client cố gửi slug -> hệ thống bỏ qua và tự sinh mã riêng
    res = await fetch(`${base}/api/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Trùng", slug: branchSlug }),
    });
    body = await res.json();
    assert.equal(res.status, 201);
    assert.ok(body.data.slug !== branchSlug);

    // Departments: tạo + lọc danh sách (mã PB-xxxx do hệ thống tự sinh)
    res = await fetch(`${base}/api/departments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Phòng ${suffix}` }),
    });
    body = await res.json();
    assert.equal(res.status, 201);
    assert.ok(/^PB-\d{4}$/.test(body.data.code));

    res = await fetch(`${base}/api/departments`);
    body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.length >= 1);

    // Employees: tạo staff + filter theo systemRole
    res = await fetch(`${base}/api/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nhân viên test", email: `staff-${suffix}@company.com`, systemRole: "staff", branchSlug }),
    });
    body = await res.json();
    assert.equal(res.status, 201);

    res = await fetch(`${base}/api/employees?systemRole=staff`);
    body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.every((e) => e.systemRole === "staff"));
    assert.ok(body.data.length >= 1);

    // Email trùng -> 409
    res = await fetch(`${base}/api/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Trùng", email: "admin@company.com", systemRole: "staff" }),
    });
    assert.equal(res.status, 409);

    // systemRole sai -> 400
    res = await fetch(`${base}/api/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sai", email: `sai-${suffix}@company.com`, systemRole: "boss" }),
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
