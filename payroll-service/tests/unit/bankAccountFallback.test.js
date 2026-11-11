"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const request = require("supertest");
const database = require("../../src/config/database");
const app = require("../../src/app");
const PayrollService = require("../../src/services/PayrollService");

// Unit test chạy khi .env đã có DATABASE_URL, nên phải thay database.getPrisma()
// tạm thời: null = chế độ memory thật, object = "có prisma nhưng query chết".
async function withPrisma(stub, fn) {
  const original = database.getPrisma;
  database.getPrisma = () => stub;
  try {
    return await fn();
  } finally {
    database.getPrisma = original;
  }
}

function failingClient(message = "connection lost") {
  const boom = async () => {
    const err = new Error(message);
    err.code = "P1001";
    throw err;
  };
  const table = { findMany: boom, findUnique: boom, create: boom, update: boom, updateMany: boom, delete: boom };
  return { bankAccount: { ...table }, payout: { ...table }, payslip: { ...table }, $transaction: boom };
}

// Client giả đọc/ghi trên mảng cho trước để dựng tình huống "DB trả về null /
// số dư thấp" trong khi kho memory vẫn có tài khoản trùng số.
function dataClient(accounts) {
  return {
    bankAccount: {
      findMany: async () => accounts.map((a) => ({ ...a })),
      findUnique: async ({ where }) => {
        const hit = accounts.find((a) => a.accountNumber === where.accountNumber || a.id === where.id);
        return hit ? { ...hit } : null;
      },
      update: async ({ where, data }) => {
        const hit = accounts.find((a) => a.accountNumber === where.accountNumber || a.id === where.id);
        if (!hit) throw new Error("không có bản ghi");
        Object.assign(hit, data);
        return { ...hit };
      },
    },
  };
}

test("listBankAccounts reject khi Prisma lỗi, không trả kho memory", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "FAIL-01", balance: 1000000 }));
  await withPrisma(failingClient(), () =>
    assert.rejects(() => PayrollService.listBankAccounts(), (err) => err.code === "P1001")
  );
});

test("findAccount reject khi Prisma lỗi, không trả tài khoản ma", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "FAIL-02", balance: 1000000 }));
  await withPrisma(failingClient(), () =>
    assert.rejects(() => PayrollService.findAccount("FAIL-02"), (err) => err.code === "P1001")
  );
});

test("debitAccount reject khi Prisma lỗi và không trừ kho memory", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "FAIL-03", balance: 700000 }));
  await withPrisma(failingClient(), () =>
    assert.rejects(() => PayrollService.debitAccount("FAIL-03", 100000), (err) => err.code === "P1001")
  );
  const acc = await withPrisma(null, () => PayrollService.findAccount("FAIL-03"));
  assert.equal(Number(acc.balance), 700000);
});

test("debitAccount reject khi Prisma không thấy tài khoản, dù memory có trùng số", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "GHOST-01", balance: 900000 }));
  await withPrisma(dataClient([]), () =>
    assert.rejects(() => PayrollService.debitAccount("GHOST-01", 100000), (err) => err.status === 404)
  );
  const acc = await withPrisma(null, () => PayrollService.findAccount("GHOST-01"));
  assert.equal(Number(acc.balance), 900000);
});

test("debitAccount vẫn báo INSUFFICIENT_FUNDS khi Prisma đọc được số dư thấp", async () => {
  await withPrisma(dataClient([{ id: "b1", accountNumber: "LOW-01", balance: 50000 }]), () =>
    assert.rejects(() => PayrollService.debitAccount("LOW-01", 100000), (err) => err.code === "INSUFFICIENT_FUNDS")
  );
});

test("createPayout abort khi Prisma lỗi: không payout, không trừ tiền memory", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "ABORT-01", balance: 5000000 }));
  const key = `abort-${Date.now()}`;
  await withPrisma(failingClient(), () =>
    assert.rejects(() =>
      PayrollService.createPayout({ idempotencyKey: key, debitAccount: "ABORT-01", totalAmount: 2500000, content: "Lương" })
    )
  );
  const [payouts, acc] = await withPrisma(null, async () => [
    await PayrollService.listPayouts(),
    await PayrollService.findAccount("ABORT-01"),
  ]);
  assert.equal(payouts.filter((p) => p.idempotencyKey === key).length, 0);
  assert.equal(Number(acc.balance), 5000000);
});

test("createPayout ở chế độ memory cũng abort khi không debit được", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "MEMO-00", balance: 100000 }));
  const key = `no-debit-${Date.now()}`;
  await withPrisma(null, () =>
    assert.rejects(
      () => PayrollService.createPayout({ idempotencyKey: key, debitAccount: "MEMO-00", totalAmount: 900000 }),
      (err) => err.code === "INSUFFICIENT_FUNDS"
    )
  );
  const payouts = await withPrisma(null, () => PayrollService.listPayouts());
  assert.equal(payouts.filter((p) => p.idempotencyKey === key).length, 0);
});

test("chế độ memory thuần vẫn liệt kê, tìm và trừ tiền được", async () => {
  await withPrisma(null, () =>
    PayrollService.createBankAccount({ accountNumber: "MEMO-01", accountName: "Công ty HRM", balance: 4000000 })
  );
  const key = `memo-${Date.now()}`;
  const payout = await withPrisma(null, () =>
    PayrollService.createPayout({ idempotencyKey: key, debitAccount: "MEMO-01", totalAmount: 1500000, content: "Lương T11" })
  );
  assert.equal(payout.status, "success");
  assert.ok(String(payout.id).startsWith("GD-"));

  const [rows, acc] = await withPrisma(null, async () => [
    await PayrollService.listBankAccounts(),
    await PayrollService.findAccount("MEMO-01"),
  ]);
  assert.ok(rows.some((r) => r.accountNumber === "MEMO-01"));
  assert.equal(Number(acc.balance), 2500000);
  assert.equal(await withPrisma(null, () => PayrollService.findAccount("KHONG-TON-TAI")), null);
});

// HTTP phải nhận 5xx thay vì 200 kèm dữ liệu memory cũ.
test("GET /bank-accounts trả 500 khi Prisma lỗi", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "HTTP-01", balance: 1000000 }));
  const res = await withPrisma(failingClient(), () => request(app).get("/api/payroll/bank-accounts"));
  assert.equal(res.status, 500);
  assert.equal(res.body.data, undefined);
});

test("POST /payouts trả 5xx khi Prisma lỗi, không ghi lệnh chi ma", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "HTTP-02", balance: 8000000 }));
  const key = `http-${Date.now()}`;
  const res = await withPrisma(failingClient(), () =>
    request(app).post("/api/payroll/payouts").send({ idempotencyKey: key, debitAccount: "HTTP-02", totalAmount: 1000000 })
  );
  assert.ok(res.status >= 500, `mong 5xx nhưng nhận ${res.status}`);
  const payouts = await withPrisma(null, () => PayrollService.listPayouts());
  assert.equal(payouts.filter((p) => p.idempotencyKey === key).length, 0);
  const acc = await withPrisma(null, () => PayrollService.findAccount("HTTP-02"));
  assert.equal(Number(acc.balance), 8000000);
});
