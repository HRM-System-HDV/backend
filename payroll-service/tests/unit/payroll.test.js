"use strict";
process.env.DATABASE_URL = "";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const db = require("../../src/config/database");
const realGet = db.getPrisma;
const Org = require("../../src/clients/OrgClient");
const Work = require("../../src/clients/WorkClient");
const service = require("../../src/services/PayrollService");
const admin = { userId: randomUUID(), role: "admin" };
const branchId = randomUUID();
afterEach(() => { db.getPrisma = realGet; });
function fixture(type = "hourly", salary = "30000") {
  const employee = { id: randomUUID(), branchId, salaryType: type, salary, standardWorkDays: type === "monthly" ? 26 : null };
  const rows = [{ employeeId: employee.id, shiftId: randomUUID(), checkIn: "2026-11-01T00:00:00Z", checkOut: "2026-11-01T05:00:00Z", penaltyAmount: "15000", shift: { status: "đang làm" } }];
  Org.getEmployeeById = async id => { assert.equal(id, employee.id); return employee; };
  Work.getAttendance = async query => { assert.equal(query.month, "2026-11"); return rows; };
  return { employee, rows, generate: () => service.generatePayslipUseCase({ employeeId: employee.id, month: "2026-11" }, admin) };
}
test("exact hourly duration, duplicate/incomplete/cancelled ca excluded", () => {
  const { employee, rows } = fixture();
  rows[0].checkOut = "2026-11-01T00:01:00Z"; rows[0].penaltyAmount = "0";
  rows.push({ ...rows[0] }, { ...rows[0], shiftId: randomUUID(), checkOut: null, penaltyAmount: "99999" }, { ...rows[0], shiftId: randomUUID(), shift: { status: "đã hủy" } });
  const result = service.calculateSalary(employee, rows);
  assert.equal(result.baseSalary, "500"); assert.equal(result.workedHours, "0.02"); assert.equal(result.totalPenalty, "0");
});
test("monthly salary uses configured workdays and sums penalties only complete ca", () => {
  const { employee, rows } = fixture("monthly", "7800000");
  assert.equal(service.calculateSalary(employee, rows).baseSalary, "300000");
  assert.equal(service.calculateSalary(employee, rows).netSalary, "285000");
  assert.throws(() => service.calculateSalary({ ...employee, standardWorkDays: 0 }, rows), /số công/);
});
test("unconfirmed refreshes salary; owner or branch manager confirms then snapshot freezes", async () => {
  const { employee, rows, generate } = fixture(); const slip = await generate();
  employee.salary = "40000"; rows[0].penaltyAmount = "20000";
  const staff = { userId: randomUUID(), employeeId: employee.id, role: "staff" };
  assert.equal((await service.getPayslip(slip.id, staff)).baseSalary, "200000");
  await assert.rejects(service.confirmPayslip(slip.id, { ...staff, employeeId: randomUUID() }), /ngoài phạm vi/);
  await assert.rejects(service.confirmPayslip(slip.id, { userId: randomUUID(), role: "manager", branchId: randomUUID() }), /ngoài phạm vi/);
  const confirmed = await service.confirmPayslip(slip.id, staff);
  assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.confirmedBy, staff.userId); assert.ok(confirmed.confirmedAt);
  employee.salary = "99999";
  assert.equal((await service.getPayslip(slip.id, staff)).baseSalary, "200000");
  await assert.rejects(service.updatePayslip(slip.id, { bonus: "1" }, admin), /đã xác nhận/);
  await assert.rejects(service.setPayslipStatus(slip.id, "paid", admin), /do lệnh chi/);
});
test("payout only confirmed; concurrent repeated key debits once, conflicts reject", async () => {
  const { generate } = fixture(); const slip = await generate();
  const account = await service.createBankAccount({ accountNumber: randomUUID(), balance: "1000000" }, admin);
  const payload = { payslipIds: [slip.id], debitAccountId: account.id, idempotencyKey: randomUUID() };
  await assert.rejects(service.createPayoutUseCase(payload, admin), /đã xác nhận/);
  await service.confirmPayslip(slip.id, admin);
  const results = await Promise.all([service.createPayoutUseCase(payload, admin), service.createPayoutUseCase(payload, admin)]);
  assert.equal(results[0].id, results[1].id); assert.equal(results[1].deduped, true); assert.match(results[0].bankReference, /^GD-/);
  const stored = (await service.listBankAccounts(admin)).find(a => a.id === account.id);
  assert.equal(stored.balance, "865000");
  assert.equal((await service.getPayslip(slip.id, admin)).status, "paid");
  await assert.rejects(service.createPayoutUseCase({ ...payload, content: "different" }, admin), /lệnh chi khác/);
  await assert.rejects(service.createPayoutUseCase({ ...payload, idempotencyKey: randomUUID() }, admin), /đã xác nhận/);
});
test("insufficient funds, wrong totals and non-admin cannot mutate payment", async () => {
  const { generate } = fixture(); const slip = await generate(); await service.confirmPayslip(slip.id, admin);
  const account = await service.createBankAccount({ accountNumber: randomUUID(), balance: "1" }, admin);
  const input = { payslipIds: [slip.id], debitAccountId: account.id, idempotencyKey: randomUUID() };
  await assert.rejects(service.createPayoutUseCase({ ...input, totalAmount: "999" }, admin), /không khớp/);
  await assert.rejects(service.createPayoutUseCase(input, admin), error => error.code === "INSUFFICIENT_FUNDS");
  assert.equal((await service.getPayslip(slip.id, admin)).status, "confirmed");
  assert.equal((await service.listBankAccounts(admin)).find(a => a.id === account.id).balance, "1");
  await assert.rejects(service.createPayoutUseCase(input, { role: "manager", userId: randomUUID() }), /quản trị/);
});
test("configured Prisma query errors never fall back to memory", async () => {
  db.getPrisma = () => ({ bankAccount: { findMany: async () => { throw new Error("DB read failed"); } } });
  await assert.rejects(service.listBankAccounts(admin), /DB read failed/);
});
test("Prisma payout writes UUID FK, claims confirmed slips and rolls back failed debit", async () => {
  const slipId = randomUUID(), accountId = randomUUID();
  let state = { account: { id: accountId, accountNumber: "123", balance: "10" }, slips: [{ id: slipId, employeeId: randomUUID(), status: "confirmed", payoutId: null, confirmedBy: admin.userId, confirmedAt: new Date(), netSalary: "100" }], payouts: [] };
  let options;
  const tx = {
    payout: {
      findUnique: async ({ where }) => { const p = state.payouts.find(r => r.idempotencyKey === where.idempotencyKey); return p ? { ...p, payslips: state.slips.filter(s => s.payoutId === p.id).map(s => ({ id: s.id })) } : null; },
      create: async ({ data }) => { assert.equal(data.debitAccountId, accountId); assert.equal(data.debitAccount, undefined); const p = { id: randomUUID(), bankReference: "GD-000001", ...data }; state.payouts.push(p); return p; },
    },
    payslip: { findMany: async () => state.slips.map(r => ({ ...r })), updateMany: async ({ where, data }) => { const selected = state.slips.filter(s => where.id.in.includes(s.id) && s.status === where.status && s.payoutId === where.payoutId); selected.forEach(s => Object.assign(s, data)); return { count: selected.length }; } },
    bankAccount: { findUnique: async () => ({ ...state.account }), updateMany: async ({ where, data }) => { if (Number(state.account.balance) < Number(where.balance.gte)) return { count: 0 }; state.account.balance = String(Number(state.account.balance) - Number(data.balance.decrement)); return { count: 1 }; } },
  };
  const prisma = { payout: tx.payout, $transaction: async (callback, opts) => { options = opts; const snapshot = structuredClone(state); try { return await callback(tx); } catch (e) { state = snapshot; throw e; } } };
  db.getPrisma = () => prisma;
  const input = { payslipIds: [slipId], debitAccountId: accountId, idempotencyKey: randomUUID() };
  await assert.rejects(service.createPayoutUseCase(input, admin), error => error.code === "INSUFFICIENT_FUNDS");
  assert.equal(state.payouts.length, 0); assert.equal(state.slips[0].status, "confirmed"); assert.equal(state.account.balance, "10");
  state.account.balance = "1000";
  const paid = await service.createPayoutUseCase(input, admin);
  assert.equal(paid.totalAmount, "100"); assert.equal(state.account.balance, "900"); assert.equal(state.slips[0].status, "paid"); assert.equal(options.isolationLevel, "Serializable");
  assert.equal((await service.createPayoutUseCase(input, admin)).deduped, true); assert.equal(state.account.balance, "900");
});