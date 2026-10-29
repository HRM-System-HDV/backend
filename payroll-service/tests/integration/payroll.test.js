"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("bank-accounts + payout idempotent + payslip generate", { timeout: 90000 }, async () => {
  const app = require("../../src/app");
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const json = { "Content-Type": "application/json" };

  try {

  // Bank accounts seed (create test account if empty)
  let res = await fetch(`${base}/api/payroll/bank-accounts`);
  let body = await res.json();
  if (body.data.length === 0) {
    await fetch(`${base}/api/payroll/bank-accounts`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ accountNumber: "111000111", accountName: "Công ty HRM", bankName: "Vietcombank", balance: 1000000000 }),
    });
    res = await fetch(`${base}/api/payroll/bank-accounts`);
    body = await res.json();
  }
  assert.equal(res.status, 200);
  assert.ok(body.data.length >= 1);
  const debit = body.data[0].accountNumber;

  // Tạo lệnh chi lần 1 -> 201, có TXN-/BANK-
  const key = `key-${Date.now()}`;
  res = await fetch(`${base}/api/payroll/payouts`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ idempotencyKey: key, debitAccount: debit, content: "Lương T10", totalAmount: 5000000, beneficiaryCount: 2 }),
  });
  body = await res.json();
  assert.equal(res.status, 201);
  assert.ok(String(body.data.id).startsWith("TXN-"));
  assert.ok(String(body.data.bankReference).startsWith("BANK-"));
  assert.equal(body.data.deduped, undefined);

  // Gửi trùng key -> 200 + deduped:true, không trừ tiền lần 2
  res = await fetch(`${base}/api/payroll/payouts`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ idempotencyKey: key, debitAccount: debit, content: "Lương T10", totalAmount: 5000000, beneficiaryCount: 2 }),
  });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.deduped, true);

  // Hết số dư -> 422 INSUFFICIENT_FUNDS
  res = await fetch(`${base}/api/payroll/payouts`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ idempotencyKey: `big-${Date.now()}`, debitAccount: debit, content: "Vượt", totalAmount: 999999999999, beneficiaryCount: 1 }),
  });
  body = await res.json();
  assert.equal(res.status, 422);
  assert.equal(body.error.code, "INSUFFICIENT_FUNDS");

  // Thiếu key -> 400
  res = await fetch(`${base}/api/payroll/payouts`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ debitAccount: debit, totalAmount: 1000 }),
  });
  assert.equal(res.status, 400);

  // Generate payslip: netSalary = base + bonus - penalty
  const uniqueEmpId = `emp-${Date.now()}`;
  res = await fetch(`${base}/api/payroll/payslips/generate`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ employeeId: uniqueEmpId, month: "10-2026", baseSalary: 10000000, bonus: 1000000, totalPenalty: 20000 }),
  });
  body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.data.netSalary, 10000000 + 1000000 - 20000);

  // Trùng cặp employeeId+month -> 409
  res = await fetch(`${base}/api/payroll/payslips/generate`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ employeeId: uniqueEmpId, month: "10-2026", baseSalary: 10000000 }),
  });
  assert.equal(res.status, 409);

  // Điều chỉnh thưởng/phạt -> netSalary tính lại
  res = await fetch(`${base}/api/payroll/payslips?employeeId=${uniqueEmpId}&month=10-2026`);
  body = await res.json();
  const slip = body.data[0];
  res = await fetch(`${base}/api/payroll/payslips/${slip.id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ bonus: 2000000 }),
  });
  body = await res.json();
  assert.equal(Number(body.data.netSalary), 10000000 + 2000000 - 20000);

  // Chốt phiếu
  res = await fetch(`${base}/api/payroll/payslips/${slip.id}/status`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ status: "đã chốt" }),
  });
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.status, "đã chốt");
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
