"use strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const request = require("supertest");
const crypto = require("crypto");
const app = require("../../src/app");
const service = require("../../src/services/AuthService");
const { signAccessToken } = require("../../src/utils/jwt");
const config = require("../../src/config");
const admin = { userId: crypto.randomUUID(), role: "admin", systemRole: "admin", clientPlatform: "web" };
async function setup() {
  const employee = { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Nhân viên", branchId: crypto.randomUUID() };
  const synced = await request(app).post("/api/auth/sync-employee").set("x-internal-token", config.internalToken).send({ employee });
  assert.equal(synced.status, 200);
  const password = await service.resetPasswordByAdminUseCase({ email: employee.email, actor: admin });
  return { ...synced.body.data.user, password: password.tempPassword };
}

test("internal employee roles come from accounts and expose only employeeId/systemRole", async () => {
  const user = await setup();
  const path = "/api/auth/internal/employee-roles";
  const payload = { employeeIds: [user.employeeId, crypto.randomUUID(), user.employeeId] };
  assert.equal((await request(app).post(path).send(payload)).status, 403);
  const query = () => request(app).post(path).set("x-internal-token", config.internalToken);
  assert.equal((await query().send({ employeeIds: ["bad-id"] })).status, 400);
  assert.equal((await query().send({})).status, 400);
  assert.equal((await query().send({ employeeIds: Array(501).fill(user.employeeId) })).status, 400);
  assert.deepEqual((await query().send(payload)).body.data, [{ employeeId: user.employeeId, systemRole: "staff" }]);
  await service.updateUserUseCase(user.id, { systemRole: "manager" }, admin);
  const result = await query().send(payload);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [{ employeeId: user.employeeId, systemRole: "manager" }]);
});
test("internal user name lookup requires internal token and only returns ID and name", async () => {
  const user = await setup();
  const path = `/api/auth/internal/users/${user.id}/name`;
  assert.equal((await request(app).get(path)).status, 403);
  assert.equal((await request(app).get(path).set("x-internal-token", "incorrect")).status, 403);
  const result = await request(app).get(path).set("x-internal-token", config.internalToken);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { id: user.id, name: user.name });
  assert.equal((await request(app).get("/api/auth/internal/users/invalid/name").set("x-internal-token", config.internalToken)).status, 400);
});

test("mobile staff cannot use web; logout invalidates registered refresh", async () => {
  const user = await setup();
  assert.equal((await request(app).post("/api/auth/login").send({ email: user.email, password: user.password })).status, 403);
  const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password, clientPlatform: "mobile" });
  assert.equal(login.status, 200);
  assert.equal(login.headers["set-cookie"], undefined);
  const token = login.body.data.accessToken;
  assert.equal((await request(app).get("/api/auth/me").auth(token, { type: "bearer" })).body.data.employeeId, user.employeeId);
  assert.equal((await request(app).get("/api/auth/me").set("Cookie", `hrm-session=${token}`)).status, 403);
  const sessions = await request(app).get("/api/auth/devices").auth(token, { type: "bearer" });
  assert.equal(sessions.body.data.length, 1);
  assert.equal(sessions.body.data[0].isCurrent, true);
  assert.equal((await request(app).post("/api/auth/logout").auth(token, { type: "bearer" }).send({})).status, 200);
  assert.equal((await request(app).post("/api/auth/refresh").send({ refreshToken: login.body.data.refreshToken })).status, 401);
});
test("admin Web cookies and management; internal sync protected", async () => {
  const user = await setup();
  assert.equal((await request(app).post("/api/auth/sync-employee").send({ employee: { id: crypto.randomUUID() } })).status, 403);
  const adminToken = signAccessToken(admin);
  assert.equal((await request(app).put(`/api/auth/users/${user.id}`).auth(adminToken, { type: "bearer" }).send({ systemRole: "admin" })).status, 200);
  const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password, clientPlatform: "web" });
  assert.equal(login.status, 200);
  assert.ok(login.headers["set-cookie"].some(cookie => cookie.startsWith("hrm-session=") && cookie.includes("HttpOnly")));
  const refresh = await request(app).post("/api/auth/refresh").set("Cookie", login.headers["set-cookie"].map(cookie => cookie.split(";")[0]).join("; ")).send({});
  assert.equal(refresh.status, 200);
  assert.equal((await request(app).get("/api/auth/users").auth(signAccessToken({ userId: crypto.randomUUID(), role: "manager" }), { type: "bearer" })).status, 403);
  const listed = await request(app).get("/api/auth/users").auth(adminToken, { type: "bearer" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data[0].passwordHash, undefined);
});
