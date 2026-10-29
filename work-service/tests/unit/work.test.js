"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateShift, validateTask } = require("../../src/validators/workValidator");

test("validateShift + validateTask", () => {
  assert.ok(validateShift({}).length > 0);
  assert.deepEqual(validateShift({ employeeId: "e-1", date: "02-10-2026" }), []);
  assert.ok(validateTask({}).length > 0);
  assert.deepEqual(validateTask({ title: "Việc" }), []);
});
