"use strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const database = require("../../src/config/database");
const service = require("../../src/services/AuthService");

test("Prisma login persists schema fields/expiry and never silently falls back on DB failure", async () => {
  const original = database.getPrisma;
  const row = { id: crypto.randomUUID(), employeeId: crypto.randomUUID(), branchId: crypto.randomUUID(), email: "postgres@example.test", name: "Nhân viên", systemRole: "staff", passwordHash: bcrypt.hashSync("valid-password", 4) };
  const sessionId = crypto.randomUUID();
  let savedToken;
  let savedDevice;
  const prisma = {
    user: { findUnique: async () => row },
    deviceSession: { create: async ({ data }) => { savedDevice = data; return { id: sessionId, ...data }; } },
    refreshToken: { create: async ({ data }) => { savedToken = data; return data; } },
  };
  database.getPrisma = () => prisma;
  try {
    const login = await service.loginUseCase({ email: row.email, password: "valid-password", clientPlatform: "mobile" });
    assert.equal(savedDevice.userId, row.id);
    assert.ok(savedDevice.lastSeenAt instanceof Date);
    assert.equal(savedDevice.lastActive, undefined);
    assert.equal(savedDevice.isCurrent, undefined);
    assert.equal(savedToken.userId, row.id);
    assert.equal(savedToken.deviceSessionId, sessionId);
    assert.ok(savedToken.expiresAt > new Date());
    assert.equal(login.user.employeeId, row.employeeId);
    prisma.refreshToken.create = async () => { throw new Error("database unavailable"); };
    await assert.rejects(service.loginUseCase({ email: row.email, password: "valid-password", clientPlatform: "mobile" }), /database unavailable/);
  } finally { database.getPrisma = original; }
});
