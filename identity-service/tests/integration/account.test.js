"use strict";

const assert = require("node:assert/strict");
const { test, describe, before, after } = require("node:test");
const app = require("../../src/app");

describe("Identity Account Endpoints Integration", () => {
  let server;
  let baseUrl;
  let cookieHeader;
  let refreshToken;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    baseUrl = `http://localhost:${server.address().port}`;

    // Đăng nhập lấy cookie & token
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@company.com", password: "123456" }),
    });
    const setCookie = res.headers.get("set-cookie");
    cookieHeader = setCookie ? setCookie.split(";")[0] : "";
    const body = await res.json();
    refreshToken = body.data.refreshToken;
  });

  after(() => {
    if (server) server.close();
  });

  test("POST /api/auth/refresh cấp lại token hợp lệ", async () => {
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.data.accessToken);
    assert.ok(body.data.refreshToken);
  });

  test("GET /api/auth/devices trả về danh sách thiết bị", async () => {
    const res = await fetch(`${baseUrl}/api/auth/devices`, {
      headers: { Cookie: cookieHeader },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
  });

  test("DELETE /api/auth/devices/:id gỡ thiết bị thành công", async () => {
    const res = await fetch(`${baseUrl}/api/auth/devices/dev-02`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.removed, true);
  });

  test("POST /api/auth/forgot-password không reset và không lộ mật khẩu", async () => {
    const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@company.com" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.contactAdmin, true);
    assert.equal(body.data.defaultPassword, undefined);
    assert.equal(body.data.tempPassword, undefined);
    assert.ok(!JSON.stringify(body).includes("123456"));

    // Mật khẩu vẫn đăng nhập được như cũ, tức là không bị đặt lại.
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@company.com", password: "123456" }),
    });
    assert.equal(login.status, 200);
  });

  test("POST /api/auth/forgot-password trả lời giống nhau cho email không tồn tại", async () => {
    const res = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "khong-ton-tai@company.com" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.contactAdmin, true);
  });

  test("POST /api/auth/reset-password chặn khi chưa đăng nhập", async () => {
    const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@company.com" }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /api/auth/reset-password chặn staff", async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nhanvien@company.com", password: "123456" }),
    });
    const staffCookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: staffCookie },
      body: JSON.stringify({ email: "admin@company.com" }),
    });
    assert.equal(res.status, 403);
  });

  test("POST /api/auth/change-password đổi mật khẩu thành công", async () => {
    const res = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ currentPassword: "123456", newPassword: "654321" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.data.ok, true);

    // Đổi lại về 123456 để không ảnh hưởng test khác
    await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ currentPassword: "654321", newPassword: "123456" }),
    });
  });

  test("đăng nhập được bằng tài khoản seed manager và staff", async () => {
    for (const [email, role] of [
      ["manager@company.com", "manager"],
      ["nhanvien@company.com", "staff"],
    ]) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "123456" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.user.role, role);
      assert.ok(body.data.accessToken);
    }
  });

  test("refresh token không dùng được như access token", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    assert.equal(res.status, 401);
  });
});
