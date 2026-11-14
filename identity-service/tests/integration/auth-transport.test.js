"use strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
// Q-A-02: web không nhận refresh token trong body (chỉ cookie httpOnly);
// mobile vẫn nhận trong body; header x-refresh-token không còn được chấp nhận.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("crypto");
const request = require("supertest");
const app = require("../../src/app");
const service = require("../../src/services/AuthService");
const config = require("../../src/config");

const admin = { userId: crypto.randomUUID(), role: "admin", systemRole: "admin", clientPlatform: "web" };

async function setup(systemRole = "manager") {
  const employee = {
    id: crypto.randomUUID(),
    email: `${crypto.randomUUID()}@example.test`,
    name: "Nhân viên",
    branchId: crypto.randomUUID(),
  };
  const synced = await request(app).post("/api/auth/sync-employee")
    .set("x-internal-token", config.internalToken)
    .send({ employee });
  const password = await service.resetPasswordByAdminUseCase({ email: employee.email, actor: admin });
  const user = synced.body.data.user;
  if (systemRole !== "staff") await service.updateUserUseCase(user.id, { systemRole }, admin);
  return { ...user, password: password.tempPassword };
}

test("đăng nhập web: body không có refreshToken, cookie httpOnly có đủ hrm-session và hrm-refresh", async () => {
  const user = await setup();
  const res = await request(app).post("/api/auth/login")
    .send({ email: user.email, password: user.password, clientPlatform: "web" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.refreshToken, undefined);
  assert.ok(res.body.data.accessToken);
  const cookies = res.headers["set-cookie"];
  assert.ok(cookies.some(cookie => cookie.startsWith("hrm-session=") && cookie.includes("HttpOnly")));
  assert.ok(cookies.some(cookie => cookie.startsWith("hrm-refresh=") && cookie.includes("HttpOnly")));
});

test("đăng nhập mobile: body có refreshToken và không set cookie phiên web", async () => {
  const user = await setup();
  const res = await request(app).post("/api/auth/login")
    .send({ email: user.email, password: user.password, clientPlatform: "mobile" });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.refreshToken);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("refresh token qua header x-refresh-token không còn được chấp nhận", async () => {
  const user = await setup();
  const login = await request(app).post("/api/auth/login")
    .send({ email: user.email, password: user.password, clientPlatform: "mobile" });
  const res = await request(app).post("/api/auth/refresh")
    .set("x-refresh-token", login.body.data.refreshToken)
    .send({});
  assert.equal(res.status, 401);
});

test("refresh mobile qua body trả token mới kèm refresh token", async () => {
  const user = await setup();
  const login = await request(app).post("/api/auth/login")
    .send({ email: user.email, password: user.password, clientPlatform: "mobile" });
  const res = await request(app).post("/api/auth/refresh")
    .send({ refreshToken: login.body.data.refreshToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);
  assert.ok(res.body.data.refreshToken);
  assert.notEqual(res.body.data.refreshToken, login.body.data.refreshToken);
});

test("refresh web dùng cookie httpOnly, body không chứa refresh token", async () => {
  const user = await setup();
  const login = await request(app).post("/api/auth/login")
    .send({ email: user.email, password: user.password, clientPlatform: "web" });
  const cookie = login.headers["set-cookie"].map(part => part.split(";")[0]).join("; ");
  const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie).send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.data.accessToken);
  assert.equal(res.body.data.refreshToken, undefined);
});

test("header x-client-platform của Gateway quyết định nền tảng, body không ghi đè được", async () => {
  const user = await setup("staff");
  // Gateway chuẩn hóa header=web -> nhân viên bị chặn dù body ghi mobile.
  const blocked = await request(app).post("/api/auth/login")
    .set("x-client-platform", "web")
    .send({ email: user.email, password: user.password, clientPlatform: "mobile" });
  assert.equal(blocked.status, 403);
  // Gateway chuẩn hóa header=mobile -> nhân viên đăng nhập được dù body ghi web.
  const allowed = await request(app).post("/api/auth/login")
    .set("x-client-platform", "mobile")
    .send({ email: user.email, password: user.password, clientPlatform: "web" });
  assert.equal(allowed.status, 200);
  assert.ok(allowed.body.data.refreshToken);
});
