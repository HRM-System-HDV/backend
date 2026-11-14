"use strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("crypto");
const { validateLogin, validateChangePassword, validateForgotPassword } = require("../../src/validators/authValidator");
const service = require("../../src/services/AuthService");
const { verifyToken, signRefreshToken } = require("../../src/utils/jwt");
const admin = { userId: crypto.randomUUID(), role: "admin" };
async function account() {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const result = await service.syncEmployeeUseCase({ employee: { id, email, name: "Nhân viên", branchId: crypto.randomUUID() } });
  const { tempPassword } = await service.resetPasswordByAdminUseCase({ email, actor: admin });
  return { ...result.user, password: tempPassword };
}
test("validators and safe user follow new schema", () => {
  assert.ok(validateLogin({}).length);
  assert.ok(validateChangePassword({ currentPassword: "123", newPassword: "123" }).length);
  assert.ok(validateForgotPassword({ email: "invalid" }).length);
  assert.throws(() => service.toSafeUser({ email: "a@b.c", systemRole: "boss" }));
  const safe = service.toSafeUser({ id: crypto.randomUUID(), email: "a@b.c", systemRole: "staff", passwordHash: "secret" });
  assert.equal(safe.passwordHash, undefined);
  assert.equal(safe.systemRole, "staff");
  assert.equal(safe.branchSlug, undefined);
});
test("sync links distinct account ID and preserves role against employee data", async () => {
  const user = await account();
  assert.notEqual(user.id, user.employeeId);
  await service.updateUserUseCase(user.id, { systemRole: "manager" }, admin);
  const synced = await service.syncEmployeeUseCase({ employee: { id: user.employeeId, email: user.email.toUpperCase(), name: "Tên mới", branchId: user.branchId, systemRole: "admin" } });
  assert.equal(synced.user.id, user.id);
  assert.equal(synced.user.systemRole, "manager");
});
test("staff mobile only; token carries canonical IDs and device location", async () => {
  const user = await account();
  await assert.rejects(service.loginUseCase({ email: user.email, password: user.password }), error => error.status === 403);
  const login = await service.loginUseCase({ email: user.email, password: user.password, clientPlatform: "mobile" }, { headers: { "x-location": encodeURIComponent("Hà Nội") } });
  const decoded = verifyToken(login.accessToken);
  assert.equal(decoded.employeeId, user.employeeId);
  assert.equal(decoded.branchId, user.branchId);
  assert.equal(decoded.clientPlatform, "mobile");
  const devices = await service.getDevicesUseCase(user.id, login.deviceSessionId);
  assert.equal(devices[0].location, "Hà Nội");
  assert.ok(devices[0].lastSeenAt);
  assert.equal(devices[0].isCurrent, true);
});
test("refresh must be registered, rotates once and cannot switch platform", async () => {
  const user = await account();
  const login = await service.loginUseCase({ email: user.email, password: user.password, clientPlatform: "mobile" });
  await assert.rejects(service.refreshTokenUseCase({ refreshToken: signRefreshToken({ userId: user.id, clientPlatform: "mobile" }) }), error => error.status === 401);
  await assert.rejects(service.refreshTokenUseCase({ refreshToken: login.refreshToken, clientPlatform: "web" }), error => error.status === 403);
  const refreshed = await service.refreshTokenUseCase({ refreshToken: login.refreshToken });
  assert.notEqual(refreshed.refreshToken, login.refreshToken);
  await assert.rejects(service.refreshTokenUseCase({ refreshToken: login.refreshToken }), error => error.status === 401);
  await service.revokeDeviceUseCase(user.id, login.deviceSessionId);
  await assert.rejects(service.refreshTokenUseCase({ refreshToken: refreshed.refreshToken }), error => error.status === 401);
});
test("password and resignation revoke refresh; manager cannot reset accounts", async () => {
  const user = await account();
  await assert.rejects(service.resetPasswordByAdminUseCase({ email: user.email, actor: { role: "manager" } }), error => error.status === 403);
  const login = await service.loginUseCase({ email: user.email, password: user.password, clientPlatform: "mobile" });
  await service.syncEmployeeUseCase({ employee: { id: user.employeeId }, action: "resign" });
  await assert.rejects(service.refreshTokenUseCase({ refreshToken: login.refreshToken }), error => error.status === 401);
  await assert.rejects(service.loginUseCase({ email: user.email, password: user.password, clientPlatform: "mobile" }), error => error.status === 401);
});
