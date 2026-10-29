"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");
const config = require("../../src/config");

describe("Health Check Unit Test", () => {
  test("Cấu hình health check có serviceName và port chuẩn", () => {
    assert.equal(config.serviceName, "integration-service");
    assert.equal(config.port, 4005);
    assert.equal(config.timeoutMs, 5000);
  });
});
