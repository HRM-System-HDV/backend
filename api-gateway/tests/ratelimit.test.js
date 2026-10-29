"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createRateLimitMiddleware } = require("../src/middlewares/rateLimit");

function mockReqRes(path = "/api/employees") {
  const req = { path, ip: "127.0.0.1", socket: {} };
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return { req, res };
}

test("vượt hạn mức trả 429 đúng envelope", () => {
  const mw = createRateLimitMiddleware({ windowMs: 60000, max: 3 });
  for (let i = 0; i < 3; i++) {
    const { req, res } = mockReqRes();
    let passed = false;
    mw(req, res, () => {
      passed = true;
    });
    assert.equal(passed, true);
  }
  const { req, res } = mockReqRes();
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, "RATE_LIMITED");
});

test("health không tính vào hạn mức", () => {
  const mw = createRateLimitMiddleware({ windowMs: 60000, max: 1 });
  const { req, res } = mockReqRes("/health");
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  assert.equal(passed, true);
});
