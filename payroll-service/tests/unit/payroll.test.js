"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validatePayout, validateGenerate } = require("../../src/validators/payrollValidator");

test("validators", () => {
  assert.ok(validatePayout({}).length > 0);
  assert.deepEqual(validatePayout({ idempotencyKey: "k", debitAccount: "a", totalAmount: 100 }), []);
  assert.ok(validateGenerate({}).length > 0);
  assert.deepEqual(validateGenerate({ employeeId: "e", month: "10-2026", baseSalary: 1 }), []);
});
