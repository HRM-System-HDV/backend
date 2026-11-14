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
  const calls = { org: 0, work: 0 };
  Org.getEmployeeById = async id => { calls.org++; assert.equal(id, employee.id); return employee; };
  Work.getAttendance = async query => { calls.work++; assert.equal(query.month, "2026-11"); return rows; };
  return { employee, rows, calls, generate: () => service.generatePayslipUseCase({ employeeId: employee.id, month: "2026-11" }, admin) };
}

test("manual bonus and total penalty survive later edits, confirmation and payout", async () => {
  const { generate, rows } = fixture();
  const slip = await generate();
  assert.equal(slip.totalPenalty, "15000");
  const adjusted = await service.updatePayslip(slip.id, { bonus: "50000", totalPenalty: "20000", adjustmentReason: "Điều chỉnh kỳ lương" }, admin);
  assert.equal(adjusted.totalPenalty, "20000");
  assert.equal(adjusted.penaltyOverride, "20000");
  assert.equal(adjusted.netSalary, "180000");
  rows[0].penaltyAmount = "90000";
  const bonusOnly = await service.updatePayslip(slip.id, { bonus: "60000" }, admin);
  assert.equal(bonusOnly.totalPenalty, "20000");
  assert.equal(bonusOnly.netSalary, "190000");
  const confirmed = await service.confirmPayslip(slip.id, admin);
  assert.equal(confirmed.totalPenalty, "20000");
  assert.equal(confirmed.adjustmentReason, "Điều chỉnh kỳ lương");
  await assert.rejects(service.updatePayslip(slip.id, { totalPenalty: "0" }, admin), /đã xác nhận/);
  const account = await service.createBankAccount({ accountNumber: randomUUID(), balance: "1000000" }, admin);
  const payout = await service.createPayoutUseCase({ idempotencyKey: randomUUID(), payslipIds: [slip.id], debitAccountId: account.id }, admin);
  assert.equal(payout.totalAmount, "190000");
  await assert.rejects(service.updatePayslip(slip.id, { bonus: "0", totalPenalty: "0" }, admin), /đã xác nhận/);
});

test("manual penalty accepts zero and can return to automatic attendance calculation", async () => {
  const { generate, rows } = fixture();
  const slip = await generate();
  assert.equal((await service.updatePayslip(slip.id, { totalPenalty: "0" }, admin)).totalPenalty, "0");
  rows[0].penaltyAmount = "30000";
  const automatic = await service.updatePayslip(slip.id, { totalPenalty: null }, admin);
  assert.equal(automatic.penaltyOverride, null);
  assert.equal(automatic.totalPenalty, "30000");
  assert.equal((await service.confirmPayslip(slip.id, admin)).totalPenalty, "30000");
});

test("manual adjustments validate money and permissions without changing the slip on failure", async () => {
  const { generate } = fixture();
  const slip = await generate();
  for (const value of ["-1", "1.5", "1000000000000000", "NaN"]) {
    await assert.rejects(service.updatePayslip(slip.id, { totalPenalty: value }, admin), /VNĐ/);
    await assert.rejects(service.updatePayslip(slip.id, { bonus: value }, admin), /VNĐ/);
  }
  await assert.rejects(service.updatePayslip(slip.id, { totalPenalty: "0" }, { userId: randomUUID(), role: "manager", branchId }), error => error.code === "FORBIDDEN");
  await assert.rejects(service.updatePayslip(slip.id, { adjustmentReason: "x".repeat(2001) }, admin), /2000/);
  assert.equal((await service.getPayslip(slip.id, admin)).totalPenalty, "15000");
});
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
test("đọc phiếu chỉ ĐỌC (không ghi DB, không gọi lại Org/Work); xác nhận thì tính lại theo mức lương mới rồi chụp bản", async () => {
  const { employee, rows, calls, generate } = fixture(); const slip = await generate();
  assert.equal(slip.baseSalary, "150000");
  const sauKhiLap = { ...calls };
  employee.salary = "40000"; rows[0].penaltyAmount = "20000";
  const staff = { userId: randomUUID(), employeeId: employee.id, role: "staff" };
  // GET chỉ đọc giá trị đã lưu, không gọi Org/Work (không còn N+1) và không ghi lại baseSalary.
  assert.equal((await service.getPayslip(slip.id, staff)).baseSalary, "150000");
  assert.deepEqual(calls, sauKhiLap);
  const list = await service.listPayslips({ employeeId: employee.id }, admin);
  assert.equal(list.length, 1); assert.equal(list[0].baseSalary, "150000");
  assert.deepEqual(calls, sauKhiLap);
  await assert.rejects(service.confirmPayslip(slip.id, { ...staff, employeeId: randomUUID() }), /ngoài phạm vi/);
  await assert.rejects(service.confirmPayslip(slip.id, { userId: randomUUID(), role: "manager", branchId: randomUUID() }), /ngoài phạm vi/);
  // Xác nhận = luồng ghi: tính lại theo mức lương hiện tại rồi chụp bản (BUSINESS.md §6.5).
  const confirmed = await service.confirmPayslip(slip.id, staff);
  assert.equal(confirmed.status, "confirmed"); assert.equal(confirmed.baseSalary, "200000"); assert.equal(confirmed.totalPenalty, "20000");
  assert.equal(confirmed.confirmedBy, staff.userId); assert.ok(confirmed.confirmedAt);
  employee.salary = "99999";
  assert.equal((await service.getPayslip(slip.id, staff)).baseSalary, "200000");
  await assert.rejects(service.updatePayslip(slip.id, { bonus: "1" }, admin), /đã xác nhận/);
  assert.equal((await service.getPayslip(slip.id, admin)).status, "confirmed", "Xác nhận không tự chuyển phiếu sang paid");
});
test("phiếu thực lĩnh 0 được chi để đóng trạng thái (không trừ tiền); thực lĩnh âm bị từ chối", async () => {
  // Phiếu 0đ: nhân viên không có ca nào hợp lệ trong kỳ.
  const employee = { id: randomUUID(), branchId, salaryType: "hourly", salary: "30000" };
  Org.getEmployeeById = async () => employee;
  Work.getAttendance = async () => [];
  const slip = await service.generatePayslipUseCase({ employeeId: employee.id, month: "2026-11" }, admin);
  assert.equal(slip.netSalary, "0");
  await service.confirmPayslip(slip.id, admin);
  const account = await service.createBankAccount({ accountNumber: randomUUID(), balance: "1000000" }, admin);
  const payout = await service.createPayoutUseCase({ payslipIds: [slip.id], debitAccountId: account.id, idempotencyKey: randomUUID() }, admin);
  assert.equal(payout.totalAmount, "0"); assert.equal(payout.beneficiaryCount, 1); assert.match(payout.bankReference, /^GD-/);
  assert.equal((await service.listBankAccounts(admin)).find(a => a.id === account.id).balance, "1000000");
  assert.equal((await service.getPayslip(slip.id, admin)).status, "paid");
  // Gửi lại cùng idempotencyKey => trả bản ghi cũ, không trừ tiền lần hai.
  const again = await service.createPayoutUseCase({ payslipIds: [slip.id], debitAccountId: account.id, idempotencyKey: payout.idempotencyKey }, admin);
  assert.equal(again.id, payout.id); assert.equal(again.deduped, true);
  assert.equal((await service.listBankAccounts(admin)).find(a => a.id === account.id).balance, "1000000");
  // Phiếu có thực lĩnh âm thì không thể chi.
  const negative = { id: randomUUID(), branchId, salaryType: "hourly", salary: "1000" };
  Org.getEmployeeById = async () => negative;
  Work.getAttendance = async () => [{ employeeId: negative.id, shiftId: randomUUID(), checkIn: "2026-11-01T00:00:00Z", checkOut: "2026-11-01T05:00:00Z", penaltyAmount: "15000" }];
  const negSlip = await service.generatePayslipUseCase({ employeeId: negative.id, month: "2026-11" }, admin);
  assert.equal(negSlip.netSalary, "-10000");
  await service.confirmPayslip(negSlip.id, admin);
  await assert.rejects(service.createPayoutUseCase({ payslipIds: [negSlip.id], debitAccountId: account.id, idempotencyKey: randomUUID() }, admin), /thực lĩnh âm/);
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
test("Q-D-05: id rác trên các đường ghi phiếu là 400, không lọt xuống Prisma", async () => {
  // Trước đây id không phải UUID đi thẳng tới Prisma -> ném P2023 -> 500 kèm
  // thông điệp thô có đường dẫn tuyệt đối của máy chủ (lộ cấu trúc repo).
  // Message giả lập bên dưới cố tình chứa đủ dấu vết đó để test PHỦ ĐỊNH bắt được.
  const leaky = new Error(
    "Invalid `prisma.payslip.findUnique()` invocation in D:\\Code\\DuAn\\PTPMDV\\backend\\payroll-service\\prisma\\schema.prisma\n" +
    "Unknown argument `id` at `payslip.findUnique(where)` at PayrollService.confirmPayslip (D:\\Code\\DuAn\\PTPMDV\\backend\\payroll-service\\src\\services\\PayrollService.js:120:7)",
  );
  let prismaCalls = 0;
  const writeCalls = [
    ["updatePayslip", (id) => service.updatePayslip(id, { bonus: "1" }, admin)],
    ["confirmPayslip", (id) => service.confirmPayslip(id, admin)],
  ];
  db.getPrisma = () => {
    prismaCalls++;
    return { payslip: { findUnique: async () => { throw leaky; }, updateMany: async () => { throw leaky; } } };
  };
  for (const badId of ["khong-phai-uuid", "../etc/passwd", ""]) {
    for (const [name, run] of writeCalls) {
      await assert.rejects(run(badId), (error) => {
        assert.equal(error.name, "ValidationError", name);
        assert.equal(error.status, 400, name);
        assert.equal(error.code, "VALIDATION_ERROR", name);
        assert.match(error.message, /UUID/, name);
        // Không được lộ đường dẫn file, stack trace hay chi tiết Prisma.
        assert.doesNotMatch(error.message, /payroll-service/, name);
        assert.doesNotMatch(error.message, /[A-Za-z]:[\\/]/, name);
        assert.doesNotMatch(error.message, /\.js:\d+/, name);
        assert.doesNotMatch(error.message, /prisma/i, name);
        return true;
      });
    }
  }
  assert.equal(prismaCalls, 0, "id rác phải bị chặn trước khi chạm tầng Prisma");

  // UUID hợp lệ thì không bị chặn định dạng: vẫn đi tới tầng tìm phiếu và nhận 404.
  const lookedUp = [];
  db.getPrisma = () => ({ payslip: { findUnique: async ({ where }) => { lookedUp.push(where.id); return null; } } });
  const goodId = randomUUID();
  for (const [name, run] of writeCalls) {
    await assert.rejects(run(goodId), (error) => {
      assert.equal(error.status, 404, `${name} với UUID hợp lệ`);
      return true;
    });
  }
  assert.deepEqual(lookedUp, writeCalls.map(() => goodId));
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

test("bankBranch là text tự do: lưu khi tạo, sửa được, xóa được bằng null", async () => {
  const account = await service.createBankAccount({ accountNumber: randomUUID(), balance: "0", bankBranch: " Sở GD Ba Đình - Hà Nội " }, admin);
  assert.equal(account.bankBranch, "Sở GD Ba Đình - Hà Nội");
  const updated = await service.updateBankAccount(account.id, { bankBranch: "Chi nhánh TP.HCM" }, admin);
  assert.equal(updated.bankBranch, "Chi nhánh TP.HCM");
  const cleared = await service.updateBankAccount(account.id, { bankBranch: null }, admin);
  assert.equal(cleared.bankBranch, null);
});
