"use strict";

// PayrollService (Flat 3-Tier Mẫu A): gộp PayrollRepository cũ + use cases,
// gọi trực tiếp Prisma + fallback in-memory. Luồng Route -> Controller -> Service -> Prisma.
const database = require("../config/database");
const { InsufficientFundsError } = require("../utils/errors");
const OrgClient = require("../clients/OrgClient");
const WorkClient = require("../clients/WorkClient");
const { monthToQuery } = require("../validators/payrollValidator");

function uid(prefix) {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${rand}`;
}
function bankRef() {
  return `BANK-${Math.floor(10000000 + Math.random() * 90000000)}`;
}

const seedAccounts = [];
let memoryAccounts = [];
let memoryPayouts = [];
let memoryPayslips = [];

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.payslip.deleteMany({}).catch(() => {});
      await prisma.payout.deleteMany({}).catch(() => {});
      await prisma.bankAccount.deleteMany({}).catch(() => {});
    } catch (_) {}
  }
  return { mode: prisma ? "postgres" : "memory" };
}

// --- Bank accounts ---
async function listBankAccounts() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.bankAccount.findMany({ orderBy: { accountNumber: "asc" } });
    } catch (_) {}
  }
  return memoryAccounts;
}

async function updateBankAccount(id, payload) {
  const allowed = {};
  for (const k of ["accountName", "bankName", "status", "balance", "isPrimary"]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      // Chỉ cho phép tối đa 1 tài khoản primary.
      if (allowed.isPrimary === true) {
        await prisma.bankAccount.updateMany({ where: {}, data: { isPrimary: false } });
      }
      return await prisma.bankAccount.update({ where: { id }, data: allowed });
    } catch (_) {}
  }
  const idx = memoryAccounts.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  if (allowed.isPrimary === true) {
    memoryAccounts = memoryAccounts.map((a) => ({ ...a, isPrimary: false }));
  }
  memoryAccounts[idx] = { ...memoryAccounts[idx], ...allowed };
  return memoryAccounts[idx];
}

async function createBankAccount(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      if (payload.isPrimary === true) {
        await prisma.bankAccount.updateMany({ where: {}, data: { isPrimary: false } });
      }
      return await prisma.bankAccount.create({ data: payload });
    } catch (_) {}
  }
  const row = { id: uid("bank"), status: "hoạt động", ...payload };
  if (row.isPrimary === true) {
    memoryAccounts = memoryAccounts.map((a) => ({ ...a, isPrimary: false }));
  }
  memoryAccounts.push(row);
  return row;
}

async function deleteBankAccount(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.bankAccount.delete({ where: { id } });
      return true;
    } catch (_) {}
  }
  const idx = memoryAccounts.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  memoryAccounts.splice(idx, 1);
  return true;
}

async function findAccount(accountNumber) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.bankAccount.findUnique({ where: { accountNumber } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryAccounts.find((a) => a.accountNumber === accountNumber) || null;
}

async function debitAccount(accountNumber, amount) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const acc = await prisma.bankAccount.findUnique({ where: { accountNumber } });
      if (acc) {
        if (acc.balance < amount) throw new InsufficientFundsError("Số dư không đủ");
        return await prisma.bankAccount.update({
          where: { accountNumber },
          data: { balance: acc.balance - amount },
        });
      }
    } catch (e) {
      if (e.code === "INSUFFICIENT_FUNDS") throw e;
    }
  }
  const acc = memoryAccounts.find((a) => a.accountNumber === accountNumber);
  if (!acc) {
    const err = new Error("Không tìm thấy tài khoản công ty");
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (acc.balance < amount) throw new InsufficientFundsError("Số dư không đủ");
  acc.balance -= amount;
  return acc;
}

// --- Payouts (idempotent) ---
async function listPayouts() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.payout.findMany({ orderBy: { createdAt: "desc" } });
    } catch (_) {}
  }
  return [...memoryPayouts].reverse();
}

async function findByIdempotencyKey(key) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.payout.findUnique({ where: { idempotencyKey: key } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryPayouts.find((p) => p.idempotencyKey === key) || null;
}

async function createPayout({ idempotencyKey, debitAccount: debitAcc, content, totalAmount, beneficiaryCount }) {
  const existed = await findByIdempotencyKey(idempotencyKey);
  if (existed) return { ...existed, deduped: true };

  await debitAccount(debitAcc, totalAmount);

  const prisma = database.getPrisma();
  const row = {
    id: uid("TXN"),
    bankReference: bankRef(),
    debitAccount: debitAcc,
    totalAmount,
    content: content || "",
    beneficiaryCount: beneficiaryCount || 0,
    idempotencyKey,
    status: "success",
    createdAt: new Date(),
  };
  if (prisma) {
    try {
      const created = await prisma.payout.create({ data: { ...row, createdAt: undefined } });
      return created;
    } catch (e) {
      if (String(e.code) === "P2002") {
        const dup = await findByIdempotencyKey(idempotencyKey);
        if (dup) return { ...dup, deduped: true };
      }
    }
  }
  memoryPayouts.push(row);
  return row;
}

async function createPayoutUseCase(payload) {
  return createPayout({
    idempotencyKey: payload.idempotencyKey,
    debitAccount: payload.debitAccount,
    content: payload.content,
    totalAmount: Number(payload.totalAmount),
    beneficiaryCount: Number(payload.beneficiaryCount || 0),
  });
}

// --- Payslips ---
async function listPayslips(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.employeeId) where.employeeId = query.employeeId;
      if (query.month) where.month = query.month;
      return await prisma.payslip.findMany({ where, orderBy: { issuedAt: "desc" } });
    } catch (_) {}
  }
  return memoryPayslips.filter((p) => {
    if (query.employeeId && p.employeeId !== query.employeeId) return false;
    if (query.month && p.month !== query.month) return false;
    return true;
  });
}

async function findPayslip(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.payslip.findUnique({ where: { id } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryPayslips.find((p) => p.id === id) || null;
}

async function findPayslipByEmployeeMonth(employeeId, month) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.payslip.findUnique({
        where: { employeeId_month: { employeeId, month } },
      });
      if (row) return row;
    } catch (_) {}
  }
  return memoryPayslips.find((p) => p.employeeId === employeeId && p.month === month) || null;
}

async function generatePayslip({ employeeId, month, baseSalary, bonus = 0, totalPenalty = 0 }) {
  const dup = await findPayslipByEmployeeMonth(employeeId, month);
  if (dup) {
    const err = new Error("Phiếu lương của nhân sự trong tháng đã tồn tại");
    err.status = 409;
    err.code = "DUPLICATE_RESOURCE";
    throw err;
  }
  const netSalary = baseSalary + bonus - totalPenalty;
  const prisma = database.getPrisma();
  const payload = {
    id: uid("ps"),
    employeeId,
    month,
    baseSalary,
    bonus,
    totalPenalty,
    netSalary,
    status: "chưa chốt",
    issuedAt: new Date(),
  };
  if (prisma) {
    try {
      return await prisma.payslip.create({ data: { ...payload, issuedAt: undefined } });
    } catch (e) {
      if (String(e.code) === "P2002") {
        const err = new Error("Phiếu lương của nhân sự trong tháng đã tồn tại");
        err.status = 409;
        err.code = "DUPLICATE_RESOURCE";
        throw err;
      }
      throw e;
    }
  }
  memoryPayslips.push(payload);
  return payload;
}

// Tổng hợp phiếu lương: baseSalary (từ body hoặc organization-service) + bonus - totalPenalty (từ work-service).
async function generatePayslipUseCase(payload) {
  let baseSalary = payload.baseSalary;
  if (baseSalary === undefined && payload.autoFetch) {
    const emp = await OrgClient.getEmployeeById(payload.employeeId);
    baseSalary = Number(emp.baseSalary || 0);
  }
  if (baseSalary === undefined) {
    const err = new Error("Thiếu lương cơ bản");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  let totalPenalty = Number(payload.totalPenalty || 0);
  if (payload.sumPenalty === true) {
    try {
      const rows = await WorkClient.getAttendance({
        employeeId: payload.employeeId,
        month: monthToQuery(payload.month),
      });
      totalPenalty = (Array.isArray(rows) ? rows : []).reduce(
        (sum, r) => sum + Number(r.penaltyAmount || 0),
        0
      );
    } catch (_) {
      // work-service chưa sẵn sàng: giữ totalPenalty đã nhập
    }
  }
  return generatePayslip({
    employeeId: payload.employeeId,
    month: payload.month,
    baseSalary: Number(baseSalary),
    bonus: Number(payload.bonus || 0),
    totalPenalty,
  });
}

async function updatePayslip(id, payload) {
  const allowed = {};
  for (const k of ["bonus", "totalPenalty", "baseSalary", "payoutId"]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  const prisma = database.getPrisma();
  const applyNet = (row) => {
    const base = allowed.baseSalary !== undefined ? allowed.baseSalary : row.baseSalary;
    const bonus = allowed.bonus !== undefined ? allowed.bonus : row.bonus;
    const pen = allowed.totalPenalty !== undefined ? allowed.totalPenalty : row.totalPenalty;
    return { ...row, ...allowed, netSalary: base + bonus - pen };
  };
  if (prisma) {
    try {
      const current = await prisma.payslip.findUnique({ where: { id } });
      if (!current) return null;
      const next = applyNet(current);
      return await prisma.payslip.update({
        where: { id },
        data: {
          ...allowed,
          netSalary: next.netSalary,
        },
      });
    } catch (_) {}
  }
  const idx = memoryPayslips.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  memoryPayslips[idx] = applyNet(memoryPayslips[idx]);
  return memoryPayslips[idx];
}

async function setPayslipStatus(id, status) {
  if (!["chưa chốt", "đã chốt"].includes(status)) {
    const err = new Error("Trạng thái phiếu chỉ nhận chưa chốt/đã chốt");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.payslip.update({ where: { id }, data: { status } });
    } catch (_) {}
  }
  const idx = memoryPayslips.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  memoryPayslips[idx] = { ...memoryPayslips[idx], status };
  return memoryPayslips[idx];
}

module.exports = {
  ensureSeeded,
  listBankAccounts,
  updateBankAccount,
  createBankAccount,
  deleteBankAccount,
  getPayslip: findPayslip,
  listPayouts,
  findByIdempotencyKey,
  createPayout,
  createPayoutUseCase,
  listPayslips,
  findPayslip,
  generatePayslip,
  generatePayslipUseCase,
  updatePayslip,
  setPayslipStatus,
};
