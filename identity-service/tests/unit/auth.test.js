"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateLogin } = require("../../src/validators/authValidator");
const { toSafeUser } = require("../../src/services/AuthService");

test("validateLogin từ chối body trống", () => {
  assert.ok(validateLogin({}).length > 0);
});

test("validateChangePassword từ chối password ngắn hơn 6 ký tự", () => {
  const { validateChangePassword } = require("../../src/validators/authValidator");
  assert.ok(validateChangePassword({ currentPassword: "123", newPassword: "123" }).length > 0);
  assert.equal(validateChangePassword({ currentPassword: "123456", newPassword: "654321" }).length, 0);
});

test("validateForgotPassword từ chối email sai định dạng", () => {
  const { validateForgotPassword } = require("../../src/validators/authValidator");
  assert.ok(validateForgotPassword({ email: "invalid-email" }).length > 0);
  assert.equal(validateForgotPassword({ email: "valid@company.com" }).length, 0);
});

test("toSafeUser từ chối role lạ và ẩn passwordHash", () => {
  assert.throws(() => toSafeUser({ id: "x", email: "a@b.c", name: "A", role: "boss", passwordHash: "secret" }));
  const safe = toSafeUser({ id: "x", email: "a@b.c", name: "A", role: "staff", passwordHash: "secret" });
  assert.equal(safe.passwordHash, undefined);
  assert.equal(safe.role, "staff");
});

