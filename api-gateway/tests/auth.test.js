"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.JWT_SECRET = "test_gateway_secret_1234567890";

const jwt = require("jsonwebtoken");
const { createAuthMiddleware } = require("../src/middlewares/auth");

function mockReq({ path = "/api/employees", method = "GET", token } = {}) {
  const req = { path, method, headers: {}, cookies: {} };
  if (token) req.headers.authorization = `Bearer ${token}`;
  return req;
}

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test("tuyến công khai login không cần token", () => {
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [{ method: "POST", path: "/api/auth/login", exact: true }] });
  let passed = false;
  mw(mockReq({ path: "/api/auth/login", method: "POST" }), mockRes(), () => {
    passed = true;
  });
  assert.equal(passed, true);
});

test("tuyến bảo vệ thiếu token trả 401", () => {
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq(), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
});

test("token hợp lệ gắn req.user và cho qua", () => {
  const token = jwt.sign({ userId: "e-1", role: "admin" }, process.env.JWT_SECRET);
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const req = mockReq({ token });
  const res = mockRes();
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  assert.equal(passed, true);
  assert.equal(req.user.userId, "e-1");
  assert.equal(req.user.role, "admin");
});

test("refresh token bị từ chối", () => {
  const token = jwt.sign({ userId: "e-1", type: "refresh" }, process.env.JWT_SECRET);
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq({ token }), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("token hết hạn trả 401", () => {
  const token = jwt.sign({ userId: "e-1" }, "sai_secret_khac");
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq({ token }), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});
