"use strict";

// PayrollService (Flat 3-Tier Mẫu A): gộp PayrollRepository cũ + use cases,
// gọi trực tiếp Prisma + fallback in-memory. Luồng Route -> Controller -> Service -> Prisma.
const database = require("../config/database");
const { InsufficientFundsError, InternalServerError } = require("../utils/errors");
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

// Sinh mã phiếu lương chuẩn: PL-0001, PL-0002...
async function nextPayslipId() {
  const prefix = "PL-";
  let max = 0;
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  const prisma = database.getPrisma();
  // Có prisma thì quét id lỗi phải nổ ra: nuốt lỗi sẽ sinh PL-0001 trùng phiếu đã có.
  if (prisma) {
    const rows = await prisma.payslip.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true },
    });
    rows.forEach((r) => scan(r.id));
  } else {
    memoryPayslips.forEach((p) => scan(p.id));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

const seedAccounts = [];
let memoryAccounts = [];
let memoryPayouts = [];
let memoryPayslips = [];

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (prisma) {
    // Không tự động xoá dữ liệu bảng lương, lệnh chi và tài khoản ngân hàng khi khởi động.
    return { mode: "postgres" };
  }
  return { mode: "memory" };
}

// --- Bank accounts ---
async function listBankAccounts() {
  const prisma = database.getPrisma();
  // Có prisma mà query lỗi thì phải để lỗi bật ra ngoài (controller trả 5xx):
  // nuốt lỗi rồi trả kho in-memory sẽ khiến caller thấy "ngân hàng trống" giả.
  if (prisma) {
    return await prisma.bankAccount.findMany({ orderBy: { accountNumber: "asc" } });
  }
  return memoryAccounts;
}

async function updateBankAccount(id, payload) {
  const allowed = {};
  // `balance` không nằm trong allowlist: số dư chỉ giảm khi có lệnh chi, không
  // cho sửa tùy ý qua API.
  for (const k of ["accountName", "bankName", "branch", "status", "isPrimary"]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      // Chỉ cho phép tối đa 1 tài khoản primary: unset và set phải cùng một
      // transaction để lỗi giữa chừng không làm mất primary cũ.
      if (allowed.isPrimary === true) {
        return await prisma.$transaction(async (tx) => {
          await tx.bankAccount.updateMany({ where: {}, data: { isPrimary: false } });
          return tx.bankAccount.update({ where: { id }, data: allowed });
        });
      }
      return await prisma.bankAccount.update({ where: { id }, data: allowed });
    } catch (err) {
      // accountNumber không nằm trong allowlist nên P2002 ở đây chỉ có nghĩa là thiếu bản ghi.
      if (String(err.code) === "P2002") return null;
      console.error("[payroll-service] Lỗi prisma.bankAccount.update:", err);
      throw err;
    }
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
  // Allowlist giống updateBankAccount, thêm accountNumber vì đây là bắt buộc khi tạo.
  const allowed = {};
  for (const k of [
    "accountNumber",
    "accountName",
    "bankName",
    "branch",
    "status",
    "balance",
    "isPrimary",
  ]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      if (allowed.isPrimary === true) {
        return await prisma.$transaction(async (tx) => {
          await tx.bankAccount.updateMany({ where: {}, data: { isPrimary: false } });
          return tx.bankAccount.create({ data: allowed });
        });
      }
      return await prisma.bankAccount.create({ data: allowed });
    } catch (err) {
      if (String(err.code) === "P2002") {
        const dup = new Error("Số tài khoản ngân hàng đã tồn tại");
        dup.status = 409;
        dup.code = "DUPLICATE_RESOURCE";
        throw dup;
      }
      console.error("[payroll-service] Lỗi prisma.bankAccount.create:", err);
      throw err;
    }
  }
  const row = { id: uid("bank"), status: "hoạt động", ...allowed };
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
    } catch (err) {
      // P2025 = không có bản ghi để xoá -> controller trả 404.
      if (String(err.code) === "P2025") return false;
      console.error("[payroll-service] Lỗi prisma.bankAccount.delete:", err);
      throw err;
    }
  }
  const idx = memoryAccounts.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  memoryAccounts.splice(idx, 1);
  return true;
}

async function findAccount(accountNumber) {
  const prisma = database.getPrisma();
  // Chỉ dùng memory khi thật sự không có prisma (chế độ memory).
  // Nếu có prisma, mọi lỗi đọc phải nổ ra để không trả về tài khoản ma.
  if (prisma) {
    return await prisma.bankAccount.findUnique({ where: { accountNumber } });
  }
  return memoryAccounts.find((a) => a.accountNumber === accountNumber) || null;
}

// Có prisma thì lỗi đọc/cập nhật phải abort: debit nhầm memory sẽ báo lệnh chi
// thành công trong khi số dư thật trên sổ cái không hề giảm.
async function debitAccount(accountNumber, amount) {
  const prisma = database.getPrisma();
  if (prisma) {
    const acc = await prisma.bankAccount.findUnique({ where: { accountNumber } });
    if (!acc) {
      const err = new Error("Không tìm thấy tài khoản công ty");
      err.status = 404;
      err.code = "NOT_FOUND";
      throw err;
    }
    if (acc.balance < amount) throw new InsufficientFundsError("Số dư không đủ");
    // Trừ bằng điều kiện (balance >= amount) để hai lệnh chi song song không
    // vượt số dư: read-then-write sẽ đọc trùng số dư cũ.
    const updated = await prisma.bankAccount.updateMany({
      where: { accountNumber, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (!updated || updated.count === 0) throw new InsufficientFundsError("Số dư không đủ");
    return await prisma.bankAccount.findUnique({ where: { accountNumber } });
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
  // Có prisma mà lỗi đọc thì để lỗi bật ra ngoài, không trả kho memory giả.
  if (prisma) {
    return await prisma.payout.findMany({ orderBy: { createdAt: "desc" } });
  }
  return [...memoryPayouts].reverse();
}

async function findByIdempotencyKey(key) {
  const prisma = database.getPrisma();
  // Có prisma thì DB là chuẩn duy nhất: lỗi tra key phải nổ (fail-closed) để
  // createPayout không mạo ghi lệnh chi trùng khi chưa kiểm được key cũ.
  if (prisma) {
    return await prisma.payout.findUnique({ where: { idempotencyKey: key } });
  }
  return memoryPayouts.find((p) => p.idempotencyKey === key) || null;
}

async function nextPayoutId() {
  const prisma = database.getPrisma();
  let max = 0;
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith("GD-")) return;
    const n = Number(s.slice(3));
    if (Number.isInteger(n) && n > max) max = n;
  };
  // Bỏ .catch nuốt lỗi: quét id mà hỏng thì max ở 0, sinh GD-0001 trùng ->
  // createPayout dính P2002 và trả lệnh chi cũ. Thả lỗi để abort giao dịch.
  if (prisma) {
    const rows = await prisma.payout.findMany({
      where: { id: { startsWith: "GD-" } },
      select: { id: true },
    });
    rows.forEach((r) => scan(r.id));
  } else {
    memoryPayouts.forEach((r) => scan(r.id));
  }
  return `GD-${String(max + 1).padStart(4, "0")}`;
}

async function createPayout({ idempotencyKey, debitAccount: debitAcc, content, totalAmount, beneficiaryCount }) {
  const existed = await findByIdempotencyKey(idempotencyKey);
  if (existed) return { ...existed, deduped: true };

  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.$transaction(async (tx) => {
        const acc = await tx.bankAccount.findUnique({ where: { accountNumber: debitAcc } });
        if (!acc) {
          const err = new Error("Không tìm thấy tài khoản công ty");
          err.status = 404;
          err.code = "NOT_FOUND";
          throw err;
        }
        if (acc.balance < totalAmount) {
          throw new InsufficientFundsError("Số dư không đủ");
        }
        // Trừ có điều kiện để hai lệnh chi chạy song song không vượt số dư.
        const debited = await tx.bankAccount.updateMany({
          where: { accountNumber: debitAcc, balance: { gte: totalAmount } },
          data: { balance: { decrement: totalAmount } },
        });
        if (!debited || debited.count === 0) {
          throw new InsufficientFundsError("Số dư không đủ");
        }

        const nextId = await nextPayoutId();
        const row = {
          id: nextId,
          bankReference: bankRef(),
          debitAccount: debitAcc,
          totalAmount,
          content: content || "",
          beneficiaryCount: beneficiaryCount || 0,
          idempotencyKey,
          status: "success",
        };
        const created = await tx.payout.create({ data: row });
        return created;
      });
    } catch (e) {
      if (String(e.code) === "P2002") {
        const dup = await findByIdempotencyKey(idempotencyKey);
        if (dup) return { ...dup, deduped: true };
      }
      if (e.code === "INSUFFICIENT_FUNDS" || e.code === "NOT_FOUND" || e.status === 404) {
        throw e;
      }
      console.error("[payroll-service] Lỗi prisma.$transaction createPayout:", e);
      throw e;
    }
  }

  // debitAccount bắt buộc chạy trước: nếu trừ tiền thất bại thì lệnh chi
  // không được ghi vào store, tránh "payout thành công" mà số dư không giảm.
  await debitAccount(debitAcc, totalAmount);
  const row = {
    id: await nextPayoutId(),
    bankReference: bankRef(),
    debitAccount: debitAcc,
    totalAmount,
    content: content || "",
    beneficiaryCount: beneficiaryCount || 0,
    idempotencyKey,
    status: "success",
    createdAt: new Date(),
  };
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
  // Có prisma mà lỗi đọc thì nổ ra ngoài, không trả danh sách phiếu memory.
  if (prisma) {
    const where = {};
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.month) where.month = query.month;
    // Quản lý được ghim chi nhánh: chỉ thấy phiếu của chi nhánh mình.
    if (query.branchSlug) where.branchSlug = query.branchSlug;
    return await prisma.payslip.findMany({ where, orderBy: { issuedAt: "desc" } });
  }
  return memoryPayslips.filter((p) => {
    if (query.employeeId && p.employeeId !== query.employeeId) return false;
    if (query.month && p.month !== query.month) return false;
    if (query.branchSlug && String(p.branchSlug || "") !== String(query.branchSlug)) return false;
    return true;
  });
}

async function findPayslip(id) {
  const prisma = database.getPrisma();
  // Có prisma thì trả kết quả DB thẳng (kể cả null); lỗi đọc phải nổ ra ngoài.
  if (prisma) {
    return await prisma.payslip.findUnique({ where: { id } });
  }
  return memoryPayslips.find((p) => p.id === id) || null;
}

async function findPayslipByEmployeeMonth(employeeId, month) {
  const prisma = database.getPrisma();
  // Có prisma thì lỗi đọc phải nổ để generatePayslip không mạo tạo phiếu trùng tháng.
  if (prisma) {
    return await prisma.payslip.findUnique({
      where: { employeeId_month: { employeeId, month } },
    });
  }
  return memoryPayslips.find((p) => p.employeeId === employeeId && p.month === month) || null;
}

async function generatePayslip({ employeeId, month, baseSalary, bonus = 0, totalPenalty = 0, branchSlug = null }) {
  const dup = await findPayslipByEmployeeMonth(employeeId, month);
  if (dup) {
    const err = new Error("Phiếu lương của nhân sự trong tháng đã tồn tại");
    err.status = 409;
    err.code = "DUPLICATE_RESOURCE";
    throw err;
  }
  const netSalary = baseSalary + bonus - totalPenalty;
  const prisma = database.getPrisma();
  const payslipId = await nextPayslipId();
  const payload = {
    id: payslipId,
    employeeId,
    month,
    baseSalary,
    bonus,
    totalPenalty,
    netSalary,
    status: "chưa chốt",
    // Chi nhánh của nhân viên: dùng để ghim phạm vi đọc cho quản lý.
    branchSlug: branchSlug || null,
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
  // Luôn cần hồ sơ nhân viên để lấy chi nhánh: quản lý chỉ được xem phiếu
  // của chi nhánh mình nên phiếu phải lưu chi nhánh ngay từ đầu.
  let employee = null;
  try {
    employee = await OrgClient.getEmployeeById(payload.employeeId);
  } catch (err) {
    console.error("[payroll-service] Không lấy được hồ sơ nhân viên:", err.message);
    throw new InternalServerError("Không đọc được hồ sơ nhân sự từ organization-service", err);
  }
  const branchSlug = employee && employee.branchSlug ? employee.branchSlug : null;

  let baseSalary = payload.baseSalary;
  if (baseSalary === undefined && employee) {
    baseSalary = Number(employee.baseSalary || 0);
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
    } catch (err) {
      console.warn("[payroll-service] Không thể lấy attendance từ work-service:", err.message);
    }
  }
  return generatePayslip({
    employeeId: payload.employeeId,
    month: payload.month,
    baseSalary: Number(baseSalary),
    bonus: Number(payload.bonus || 0),
    totalPenalty,
    branchSlug,
  });
}

async function updatePayslip(id, payload) {
  const allowed = {};
  for (const k of ["bonus", "totalPenalty", "baseSalary", "payoutId"]) {
    if (payload[k] !== undefined) allowed[k] = payload[k];
  }
  // Phiếu đã chốt là chứng từ đã bàn giao nên cấm sửa các trường tiền.
  // payoutId vẫn ghi được vì đó là liên kết lệnh chi của luồng chi lương, không phải số lương.
  if (["baseSalary", "bonus", "totalPenalty"].some((k) => allowed[k] !== undefined)) {
    const current = await findPayslip(id);
    if (!current) return null;
    if (current.status === "đã chốt") {
      const err = new Error("Phiếu lương đã chốt, không thể thay đổi");
      err.status = 409;
      err.code = "PAYSIP_LOCKED";
      throw err;
    }
  }
  const prisma = database.getPrisma();
  const applyNet = (row) => {
    const base = allowed.baseSalary !== undefined ? allowed.baseSalary : row.baseSalary;
    const bonus = allowed.bonus !== undefined ? allowed.bonus : row.bonus;
    const pen = allowed.totalPenalty !== undefined ? allowed.totalPenalty : row.totalPenalty;
    return { ...row, ...allowed, netSalary: base + bonus - pen };
  };
  // Có prisma thì ghi lỗi phải abort: nuốt lỗi rồi sửa mảng memory sẽ báo "đã sửa"
  // trong khi phiếu lương thật trên DB không hề đổi.
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
    } catch (err) {
      console.error("[payroll-service] Lỗi prisma.payslip.update:", err);
      throw err;
    }
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
  // Không cho hạ phiếu từ "đã chốt" về "chưa chốt": dịch vụ này không có nghiệp vụ reopen.
  if (status === "chưa chốt") {
    const current = await findPayslip(id);
    if (current && current.status === "đã chốt") {
      const err = new Error("Phiếu lương đã chốt, không thể mở lại");
      err.status = 409;
      err.code = "PAYSIP_LOCKED";
      throw err;
    }
  }
  const prisma = database.getPrisma();
  // Ghi status lỗi phải abort, không sửa mảng memory: tránh báo "đã chốt" giả.
  // P2025 (không có phiếu) vẫn trả null để controller báo 404 như trước.
  if (prisma) {
    try {
      return await prisma.payslip.update({ where: { id }, data: { status } });
    } catch (err) {
      if (String(err.code) === "P2025") return null;
      console.error("[payroll-service] Lỗi prisma.payslip.setStatus:", err);
      throw err;
    }
  }
  const idx = memoryPayslips.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  memoryPayslips[idx] = { ...memoryPayslips[idx], status };
  return memoryPayslips[idx];
}

module.exports = {
  ensureSeeded,
  listBankAccounts,
  findAccount,
  debitAccount,
  updateBankAccount,
  createBankAccount,
  deleteBankAccount,
  getPayslip: findPayslip,
  listPayouts,
  findByIdempotencyKey,
  nextPayslipId,
  nextPayoutId,
  createPayout,
  createPayoutUseCase,
  listPayslips,
  findPayslip,
  generatePayslip,
  generatePayslipUseCase,
  updatePayslip,
  setPayslipStatus,
};
