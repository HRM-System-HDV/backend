"use strict";

const assert = require("node:assert/strict");
const { test, describe, before, after } = require("node:test");
const app = require("../../src/app");

describe("Integration Service Health Endpoint Test", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test("GET /health trả status 200 và envelope chuẩn", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "integration-service");
    assert.ok(body.time);
  });

  test("GET /api/random-unknown trả lỗi 404 đúng chuẩn envelope", async () => {
    const res = await fetch(`${baseUrl}/api/random-unknown`);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.message, "Không tìm thấy tài nguyên");
  });
});
