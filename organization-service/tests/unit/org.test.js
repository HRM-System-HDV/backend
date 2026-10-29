"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateEmployee } = require("../../src/validators/orgValidator");

test("validateEmployee systemRole", () => {
  assert.deepEqual(validateEmployee({ name: "A", email: "a@company.com", systemRole: "staff" }), []);
  assert.ok(validateEmployee({ name: "A", email: "a@company.com", systemRole: "boss" }).length > 0);
});
