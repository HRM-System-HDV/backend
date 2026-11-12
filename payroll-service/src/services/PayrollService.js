"use strict";
const crypto = require("node:crypto");
const { Prisma } = require("@prisma/client");
const database = require("../config/database");
const OrgClient = require("../clients/OrgClient");
const WorkClient = require("../clients/WorkClient");
const { ValidationError, NotFoundError, DuplicateError, InsufficientFundsError, ForbiddenError } = require("../utils/errors");
const { assertOwnPayslip, scopePayslipQuery, requireAdmin } = require("../utils/caller");
const { uuid, month, money } = require("../validators/payrollValidator");
const Decimal = Prisma.Decimal;
const memory = { accounts: [], payslips: [], payouts: [] };
let sequence = 0;
let memoryQueue = Promise.resolve();
function exclusive(fn) { const run = memoryQueue.then(fn); memoryQueue = run.catch(() => {}); return run; }
const sum = values => values.reduce((a, b) => a.plus(b), new Decimal(0));
const rounded = value => new Decimal(value).toFixed(0, Decimal.ROUND_HALF_UP);
function required(row, message) { if (!row) throw new NotFoundError(message); return row; }
function clone(row) { return row && { ...row }; }
async function listBankAccounts(actor) { requireAdmin(actor); const db = database.getPrisma(); return db ? db.bankAccount.findMany({ orderBy: { accountNumber: "asc" } }) : memory.accounts.map(clone); }
function accountData(payload, create) {
  const data = {};
  for (const key of ["accountName", "bankName"]) if (payload[key] !== undefined) data[key] = payload[key] === null ? null : String(payload[key]).trim();
  if (payload.branchId !== undefined) data.branchId = payload.branchId === null ? null : uuid(payload.branchId, "branchId");
  if (payload.isPrimary !== undefined) { if (typeof payload.isPrimary !== "boolean") throw new ValidationError("isPrimary phải là boolean"); data.isPrimary = payload.isPrimary; }
  if (create) {
    if (typeof payload.accountNumber !== "string" || !payload.accountNumber.trim()) throw new ValidationError("Thiếu số tài khoản");
    data.accountNumber = payload.accountNumber.trim(); data.balance = money(payload.balance ?? 0, "balance");
    data.isPrimary ??= false;
  } else if (payload.balance !== undefined || payload.accountNumber !== undefined) throw new ValidationError("Không được sửa số dư hoặc số tài khoản bằng cập nhật cấu hình");
  return data;
}
async function createBankAccount(payload, actor) {
  requireAdmin(actor); const data = accountData(payload, true); const db = database.getPrisma();
  if (db) {
    try { return await db.$transaction(async tx => { if (data.isPrimary) await tx.bankAccount.updateMany({ data: { isPrimary: false } }); return tx.bankAccount.create({ data }); }, { isolationLevel: "Serializable" }); }
    catch (error) { if (error.code === "P2002") throw new DuplicateError("Số tài khoản đã tồn tại"); throw error; }
  }
  return exclusive(() => { if (memory.accounts.some(a => a.accountNumber === data.accountNumber)) throw new DuplicateError("Số tài khoản đã tồn tại"); if (data.isPrimary) memory.accounts.forEach(a => { a.isPrimary = false; }); const row = { id: crypto.randomUUID(), branchId: null, accountName: null, bankName: null, ...data, createdAt: new Date() }; memory.accounts.push(row); return clone(row); });
}
async function updateBankAccount(id, payload, actor) {
  requireAdmin(actor); uuid(id); const data = accountData(payload, false); const db = database.getPrisma();
  if (db) return db.$transaction(async tx => { required(await tx.bankAccount.findUnique({ where: { id } }), "Không tìm thấy tài khoản"); if (data.isPrimary) await tx.bankAccount.updateMany({ data: { isPrimary: false } }); return tx.bankAccount.update({ where: { id }, data }); }, { isolationLevel: "Serializable" });
  return exclusive(() => { const row = required(memory.accounts.find(a => a.id === id), "Không tìm thấy tài khoản"); if (data.isPrimary) memory.accounts.forEach(a => { a.isPrimary = false; }); Object.assign(row, data); return clone(row); });
}
async function deleteBankAccount(id, actor) {
  requireAdmin(actor); uuid(id); const db = database.getPrisma();
  if (db) { required(await db.bankAccount.findUnique({ where: { id } }), "Không tìm thấy tài khoản"); if (await db.payout.count({ where: { debitAccountId: id } })) throw new DuplicateError("Tài khoản đã có lệnh chi, không được xóa"); await db.bankAccount.delete({ where: { id } }); }
  else await exclusive(() => { const row = required(memory.accounts.find(a => a.id === id), "Không tìm thấy tài khoản"); if (memory.payouts.some(p => p.debitAccountId === id)) throw new DuplicateError("Tài khoản đã có lệnh chi, không được xóa"); memory.accounts.splice(memory.accounts.indexOf(row), 1); });
  return { ok: true };
}
function calculateSalary(employee, records, bonus = 0) {
  const rate = new Decimal(money(employee.salary, "salary"));
  if (!["hourly", "monthly"].includes(employee.salaryType)) throw new ValidationError("Kiểu lương không hợp lệ");
  if (employee.salaryType === "monthly" && (!Number.isInteger(employee.standardWorkDays) || employee.standardWorkDays <= 0)) throw new ValidationError("Fulltime phải có số công thỏa thuận lớn hơn 0");
  let milliseconds = 0; let count = 0; const penalties = []; const seen = new Set();
  for (const row of records) {
    if (!row.shiftId || seen.has(row.shiftId) || row.employeeId !== employee.id || !row.checkIn || !row.checkOut || row.shift?.status === "đã hủy") continue;
    const duration = Date.parse(row.checkOut) - Date.parse(row.checkIn);
    if (!Number.isFinite(duration) || duration < 0) continue;
    seen.add(row.shiftId); milliseconds += duration; count++;
    penalties.push(money(row.penaltyAmount ?? 0, "penaltyAmount"));
  }
  const rawSalary = employee.salaryType === "hourly" ? rate.times(milliseconds).div(3600000) : rate.times(count).div(employee.standardWorkDays);
  const baseSalary = rounded(rawSalary); const totalPenalty = rounded(sum(penalties)); const bonusAmount = money(bonus, "bonus");
  return { salaryType: employee.salaryType, salaryRate: rate.toFixed(0), workedHours: employee.salaryType === "hourly" ? new Decimal(milliseconds).div(3600000).toFixed(2) : null, baseSalary, totalPenalty, bonus: bonusAmount, netSalary: new Decimal(baseSalary).plus(bonusAmount).minus(totalPenalty).toFixed(0), branchId: employee.branchId || null };
}
async function computed(employeeId, period, bonus) {
  const employee = required(await OrgClient.getEmployeeById(employeeId), "Không tìm thấy nhân viên");
  const records = await WorkClient.getAttendance({ employeeId, month: period });
  if (!Array.isArray(records)) throw new ValidationError("Dữ liệu chấm công không hợp lệ");
  return calculateSalary(employee, records, bonus);
}
async function rawPayslip(id) { const db = database.getPrisma(); return db ? db.payslip.findUnique({ where: { id } }) : clone(memory.payslips.find(p => p.id === id)); }
async function refreshPending(row) {
  if (row.status !== "pending_confirmation") return row;
  const data = await computed(row.employeeId, row.month, row.bonus);
  const db = database.getPrisma();
  if (db) { await db.payslip.updateMany({ where: { id: row.id, status: "pending_confirmation", payoutId: null }, data }); return db.payslip.findUnique({ where: { id: row.id } }); }
  return exclusive(() => { const current = required(memory.payslips.find(p => p.id === row.id), "Không tìm thấy phiếu lương"); if (current.status === "pending_confirmation") Object.assign(current, data); return clone(current); });
}
async function getPayslip(id, actor) {
  uuid(id);
  const row = required(await rawPayslip(id), "Không tìm thấy phiếu lương");
  assertOwnPayslip(row, actor);
  const refreshed = await refreshPending(row);
  assertOwnPayslip(refreshed, actor);
  return refreshed;
}
async function listPayslips(query, actor) {
  const scoped = scopePayslipQuery(query, actor); const where = {};
  if (scoped.employeeId) where.employeeId = uuid(scoped.employeeId, "employeeId");
  if (scoped.branchId) where.branchId = uuid(scoped.branchId, "branchId");
  if (scoped.month) where.month = month(scoped.month);
  const db = database.getPrisma(); const rows = db ? await db.payslip.findMany({ where, orderBy: { issuedAt: "desc" } }) : memory.payslips.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)).map(clone);
  const refreshed = await Promise.all(rows.map(refreshPending));
  return refreshed.filter(row => {
    try { assertOwnPayslip(row, actor); return true; } catch (error) { if (error.code === "FORBIDDEN") return false; throw error; }
  });
}
async function generatePayslipUseCase(payload, actor) {
  requireAdmin(actor); const employeeId = uuid(payload.employeeId, "employeeId"); const period = month(payload.month);
  const data = await computed(employeeId, period, payload.bonus ?? 0); const db = database.getPrisma();
  const create = { employeeId, month: period, ...data, status: "pending_confirmation" };
  if (db) { try { return await db.payslip.create({ data: create }); } catch (error) { if (error.code === "P2002") throw new DuplicateError("Phiếu lương của nhân viên trong tháng đã tồn tại"); throw error; } }
  return exclusive(() => { if (memory.payslips.some(p => p.employeeId === employeeId && p.month === period)) throw new DuplicateError("Phiếu lương của nhân viên trong tháng đã tồn tại"); const row = { id: crypto.randomUUID(), ...create, payoutId: null, confirmedBy: null, confirmedAt: null, issuedAt: new Date() }; memory.payslips.push(row); return clone(row); });
}
async function updatePayslip(id, payload, actor) {
  requireAdmin(actor); if (Object.keys(payload).some(k => k !== "bonus")) throw new ValidationError("Chỉ được điều chỉnh thưởng trên phiếu chưa xác nhận");
  const current = await getPayslip(id, actor); if (current.status !== "pending_confirmation") throw new DuplicateError("Phiếu đã xác nhận, không được sửa");
  const data = await computed(current.employeeId, current.month, payload.bonus ?? current.bonus); const db = database.getPrisma();
  if (db) { const updated = await db.payslip.updateMany({ where: { id, status: "pending_confirmation", payoutId: null }, data }); if (updated.count !== 1) throw new DuplicateError("Phiếu đã được xác nhận"); return db.payslip.findUnique({ where: { id } }); }
  return exclusive(() => { const row = required(memory.payslips.find(p => p.id === id), "Không tìm thấy phiếu"); if (row.status !== "pending_confirmation") throw new DuplicateError("Phiếu đã xác nhận"); Object.assign(row, data); return clone(row); });
}
async function confirmPayslip(id, actor) {
  if (!actor?.userId) throw new ForbiddenError("Thiếu danh tính xác nhận");
  const current = await getPayslip(id, actor);
  if (current.status === "confirmed") return current;
  if (current.status !== "pending_confirmation") throw new DuplicateError("Phiếu đã thanh toán");
  const data = { status: "confirmed", confirmedBy: actor.userId, confirmedAt: new Date() }; const db = database.getPrisma();
  if (db) { const updated = await db.payslip.updateMany({ where: { id, status: "pending_confirmation", payoutId: null }, data }); if (updated.count !== 1) throw new DuplicateError("Phiếu vừa được xử lý, hãy tải lại"); return db.payslip.findUnique({ where: { id } }); }
  return exclusive(() => { const row = memory.payslips.find(p => p.id === id); if (row.status !== "pending_confirmation") throw new DuplicateError("Phiếu vừa được xử lý"); Object.assign(row, data); return clone(row); });
}
async function setPayslipStatus(id, status, actor) { if (status !== "confirmed") throw new ValidationError("Chỉ được xác nhận phiếu; trạng thái paid do lệnh chi thành công cập nhật"); return confirmPayslip(id, actor); }
const payoutInclude = { payslips: { select: { id: true } } };
async function findByIdempotencyKey(key) { const db = database.getPrisma(); return db ? db.payout.findUnique({ where: { idempotencyKey: key }, include: payoutInclude }) : clone(memory.payouts.find(p => p.idempotencyKey === key)); }
function payoutInput(payload) {
  if (typeof payload.idempotencyKey !== "string" || !payload.idempotencyKey.trim()) throw new ValidationError("Thiếu idempotencyKey");
  if (!Array.isArray(payload.payslipIds) || !payload.payslipIds.length) throw new ValidationError("Chọn ít nhất một phiếu đã xác nhận");
  const ids = payload.payslipIds.map(id => uuid(id, "payslipIds")).sort();
  if (new Set(ids).size !== ids.length) throw new ValidationError("Không được chọn trùng phiếu lương");
  if (!payload.debitAccountId && !payload.debitAccount) throw new ValidationError("Thiếu tài khoản trích nợ");
  if (payload.debitAccountId && payload.debitAccount) throw new ValidationError("Chỉ chọn một định danh tài khoản trích nợ");
  return { ...payload, idempotencyKey: payload.idempotencyKey.trim(), ids, debitAccountId: payload.debitAccountId ? uuid(payload.debitAccountId, "debitAccountId") : null, content: String(payload.content || "") };
}
function duplicateResult(row, input) {
  const ids = (row.payslips || []).map(p => p.id).sort();
  if (ids.join() !== input.ids.join() || row.content !== input.content || (input.debitAccountId ? row.debitAccountId !== input.debitAccountId : row.debitAccountNumber !== String(input.debitAccount)) || (input.totalAmount !== undefined && !new Decimal(row.totalAmount).eq(money(input.totalAmount, "totalAmount"))) || (input.beneficiaryCount !== undefined && Number(input.beneficiaryCount) !== row.beneficiaryCount)) throw new DuplicateError("idempotencyKey đã được dùng cho một lệnh chi khác");
  return { ...row, deduped: true };
}
function payoutTotals(rows, input) {
  if (rows.length !== input.ids.length || rows.some(p => p.status !== "confirmed" || p.payoutId || !p.confirmedBy || !p.confirmedAt)) throw new ValidationError("Chỉ chi các phiếu đã xác nhận và chưa thanh toán");
  if (rows.some(p => new Decimal(p.netSalary).lte(0))) throw new ValidationError("Phiếu được chi phải có thực lĩnh lớn hơn 0");
  const total = sum(rows.map(p => p.netSalary)).toFixed(0); const count = new Set(rows.map(p => p.employeeId)).size;
  if ((input.totalAmount !== undefined && !new Decimal(total).eq(money(input.totalAmount, "totalAmount"))) || (input.beneficiaryCount !== undefined && Number(input.beneficiaryCount) !== count)) throw new ValidationError("Tổng tiền hoặc số người hưởng không khớp các phiếu đã chọn");
  return { totalAmount: total, beneficiaryCount: count };
}
async function createPayoutUseCase(payload, actor) {
  requireAdmin(actor); const input = payoutInput(payload); const db = database.getPrisma();
  if (!db) return exclusive(() => {
    const existed = memory.payouts.find(p => p.idempotencyKey === input.idempotencyKey); if (existed) return duplicateResult(existed, input);
    const rows = memory.payslips.filter(p => input.ids.includes(p.id)); const totals = payoutTotals(rows, input);
    const account = required(memory.accounts.find(a => input.debitAccountId ? a.id === input.debitAccountId : a.accountNumber === String(input.debitAccount)), "Không tìm thấy tài khoản nguồn");
    if (new Decimal(account.balance).lt(totals.totalAmount)) throw new InsufficientFundsError();
    const row = { id: crypto.randomUUID(), bankReference: `GD-${String(++sequence).padStart(6, "0")}`, debitAccountId: account.id, debitAccountNumber: account.accountNumber, ...totals, content: input.content, idempotencyKey: input.idempotencyKey, status: "success", createdAt: new Date(), payslips: rows.map(p => ({ id: p.id })) };
    account.balance = new Decimal(account.balance).minus(totals.totalAmount).toFixed(0); rows.forEach(p => { p.status = "paid"; p.payoutId = row.id; }); memory.payouts.push(row); return clone(row);
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.$transaction(async tx => {
      const existed = await tx.payout.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: payoutInclude }); if (existed) return duplicateResult(existed, input);
      const rows = await tx.payslip.findMany({ where: { id: { in: input.ids } } }); const totals = payoutTotals(rows, input);
      const account = required(await tx.bankAccount.findUnique({ where: input.debitAccountId ? { id: input.debitAccountId } : { accountNumber: String(input.debitAccount) } }), "Không tìm thấy tài khoản nguồn");
      const row = await tx.payout.create({ data: { debitAccountId: account.id, debitAccountNumber: account.accountNumber, ...totals, content: input.content, idempotencyKey: input.idempotencyKey, status: "success" } });
      const claimed = await tx.payslip.updateMany({ where: { id: { in: input.ids }, status: "confirmed", payoutId: null }, data: { status: "paid", payoutId: row.id } });
      if (claimed.count !== input.ids.length) throw new DuplicateError("Phiếu đã được chi bởi một lệnh khác");
      const debit = await tx.bankAccount.updateMany({ where: { id: account.id, balance: { gte: totals.totalAmount } }, data: { balance: { decrement: totals.totalAmount } } });
      if (debit.count !== 1) throw new InsufficientFundsError();
      return { ...row, payslips: rows.map(p => ({ id: p.id })) };
    }, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (error.code === "P2002") { const row = await findByIdempotencyKey(input.idempotencyKey); if (row) return duplicateResult(row, input); }
      if (error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}
async function listPayouts(actor) { requireAdmin(actor); const db = database.getPrisma(); return db ? db.payout.findMany({ orderBy: { createdAt: "desc" }, include: payoutInclude }) : memory.payouts.map(clone); }
module.exports = { listBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount, calculateSalary, getPayslip, listPayslips, generatePayslipUseCase, updatePayslip, confirmPayslip, setPayslipStatus, createPayoutUseCase, listPayouts, findByIdempotencyKey };
