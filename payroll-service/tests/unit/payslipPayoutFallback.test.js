"use strict";

// Test gia đình lỗi "nuốt lỗi Prisma rồi trả kho in-memory" cho các site còn lại
// (payslip + payout). Nối lại database.getPrisma() y hệt bankAccountFallback.test.js:
// null = chế độ memory thật, object = "có prisma nhưng query chết".
const assert = require("node:assert/strict");
const { test } = require("node:test");
const database = require("../../src/config/database");
const PayrollService = require("../../src/services/PayrollService");

async function withPrisma(stub, fn) {
  const original = database.getPrisma;
  database.getPrisma = () => stub;
  try {
    return await fn();
  } finally {
    database.getPrisma = original;
  }
}

function prismaErr(code, message) {
  const err = new Error(message || "connection lost");
  err.code = code;
  return err;
}

// Client giả đọc/ghi trên mảng, có cờ hỏng theo loại thao tác và $transaction
// rollback khi callback ném lỗi (đúng semantics Postgres) để kiểm chứng tiền.
function createStubDb(seed = {}) {
  const state = {
    bankAccount: (seed.bankAccount || []).map((r) => ({ ...r })),
    payout: (seed.payout || []).map((r) => ({ ...r })),
    payslip: (seed.payslip || []).map((r) => ({ ...r })),
    failIdScan: false, // chỉ hỏng query quét id (where.id.startsWith + select id)
    update: "ok", // "ok" | "reject" (P1001) | "notfound" (P2025)
  };
  const isIdScan = (args) =>
    Boolean(
      args &&
        args.where &&
        args.where.id &&
        typeof args.where.id === "object" &&
        "startsWith" in args.where.id
    );
  const matches = (row, where) => {
    if (where && "accountNumber" in where) return row.accountNumber === where.accountNumber;
    if (where && "idempotencyKey" in where) return row.idempotencyKey === where.idempotencyKey;
    if (where && "employeeId_month" in where) {
      const k = where.employeeId_month;
      return row.employeeId === k.employeeId && row.month === k.month;
    }
    if (where && "id" in where) return row.id === where.id;
    return false;
  };
  // Điều kiện của updateMany: hỗ trợ so sánh bằng và so sánh >= để giống
  // prisma (dùng để trừ số dư có điều kiện).
  const matchesMany = (row, where = {}) => {
    for (const [key, cond] of Object.entries(where)) {
      if (cond && typeof cond === "object") {
        if ("gte" in cond && !(Number(row[key] || 0) >= Number(cond.gte))) return false;
        if ("equals" in cond && String(row[key]) !== String(cond.equals)) return false;
        continue;
      }
      if (String(row[key]) !== String(cond)) return false;
    }
    return true;
  };
  const table = (name) => ({
    findMany: async (args) => {
      if (isIdScan(args) && state.failIdScan) throw prismaErr("P1001");
      return state[name].map((r) => ({ ...r }));
    },
    findUnique: async (args) => {
      const hit = state[name].find((r) => matches(r, args.where));
      return hit ? { ...hit } : null;
    },
    create: async (args) => {
      const d = args.data;
      if (state[name].some((r) => r.id === d.id)) throw prismaErr("P2002", "trùng id");
      if (name === "payout" && state[name].some((r) => r.idempotencyKey === d.idempotencyKey))
        throw prismaErr("P2002", "trùng key");
      if (name === "payslip" && state[name].some((r) => r.employeeId === d.employeeId && r.month === d.month))
        throw prismaErr("P2002", "trùng tháng");
      const row = { createdAt: new Date(), ...d };
      state[name].push(row);
      return { ...row };
    },
    update: async (args) => {
      if (state.update === "reject") throw prismaErr("P1001");
      if (state.update === "notfound") throw prismaErr("P2025", "không có bản ghi");
      const idx = state[name].findIndex((r) => matches(r, args.where));
      if (idx < 0) throw prismaErr("P2025");
      state[name][idx] = { ...state[name][idx], ...args.data };
      return { ...state[name][idx] };
    },
    updateMany: async (args) => {
      const where = (args && args.where) || {};
      const data = (args && args.data) || {};
      let count = 0;
      state[name] = state[name].map((r) => {
        if (!matchesMany(r, where)) return r;
        count += 1;
        const next = { ...r };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "decrement" in v) {
            next[k] = Number(r[k] || 0) - Number(v.decrement);
          } else if (v && typeof v === "object" && "increment" in v) {
            next[k] = Number(r[k] || 0) + Number(v.increment);
          } else {
            next[k] = v;
          }
        }
        return next;
      });
      return { count };
    },
    delete: async () => ({}),
  });
  const client = {
    bankAccount: table("bankAccount"),
    payout: table("payout"),
    payslip: table("payslip"),
    $transaction: async (fn) => {
      const snap = {
        bankAccount: state.bankAccount.map((r) => ({ ...r })),
        payout: state.payout.map((r) => ({ ...r })),
        payslip: state.payslip.map((r) => ({ ...r })),
      };
      try {
        return await fn(client);
      } catch (e) {
        state.bankAccount = snap.bankAccount;
        state.payout = snap.payout;
        state.payslip = snap.payslip;
        throw e;
      }
    },
    __state: state,
  };
  return client;
}

// Client giả mà mọi thao tác payslip/payout đều ném lỗi kết nối.
function allFailingStub() {
  const boom = async () => {
    throw prismaErr("P1001");
  };
  const table = { findMany: boom, findUnique: boom, create: boom, update: boom, updateMany: boom, delete: boom };
  return { bankAccount: { ...table }, payout: { ...table }, payslip: { ...table }, $transaction: boom };
}

// (a) nextPayoutId: quét id hỏng phải NÉM, không được trả id đã tồn tại.
test("(a) nextPayoutId ném lỗi khi quét id hỏng, không trả id đã tồn tại", async () => {
  const db = createStubDb({ payout: [{ id: "GD-0001", idempotencyKey: "seed-1" }] });
  const ok = await withPrisma(db, () => PayrollService.nextPayoutId());
  assert.equal(ok, "GD-0002", "quét đúng phải ra id kế tiếp, không trùng GD-0001");
  db.__state.failIdScan = true;
  await assert.rejects(
    () => withPrisma(db, () => PayrollService.nextPayoutId()),
    (e) => e.code === "P1001",
    "quét id hỏng phải nổ chứ không im lặng trả GD-0001"
  );
});

// (a2) nextPayslipId cùng luật.
test("(a2) nextPayslipId ném lỗi khi quét id hỏng", async () => {
  const db = createStubDb({ payslip: [{ id: "PL-0001", employeeId: "NV-A", month: "01-2026" }] });
  assert.equal(await withPrisma(db, () => PayrollService.nextPayslipId()), "PL-0002");
  db.__state.failIdScan = true;
  await assert.rejects(
    () => withPrisma(db, () => PayrollService.nextPayslipId()),
    (e) => e.code === "P1001"
  );
});

// (b/3) GD-0001 proof: sau khi có một lệnh chi, làm hỏng quét id và thử lệnh chi MỚI.
// Trước khi sửa, quét id nuốt lỗi -> sinh GD-0001 trùng -> P2002 -> trả "lệnh chi cũ
// dedup". Sau khi sửa: giao dịch abort, không ghi, không dedup nhầm, số dư không đổi.
test("(b/3) createPayout khi quét id hỏng: abort, không ghi, không trả lại GD-0001 cũ", async () => {
  const db = createStubDb({ bankAccount: [{ id: "b1", accountNumber: "CKG-01", balance: 10000000 }] });
  const first = await withPrisma(db, () =>
    PayrollService.createPayout({
      idempotencyKey: "gd-ok-1",
      debitAccount: "CKG-01",
      totalAmount: 1000000,
      content: "Lương T1",
    })
  );
  assert.equal(first.id, "GD-0001");
  assert.notEqual(first.deduped, true);
  assert.equal(Number(db.__state.bankAccount[0].balance), 9000000);

  db.__state.failIdScan = true;
  // Lệnh chi thứ hai có idempotencyKey KHÁC -> nếu trả về thì đó không phải của nó.
  await assert.rejects(
    () =>
      withPrisma(db, () =>
        PayrollService.createPayout({
          idempotencyKey: "gd-fail-2",
          debitAccount: "CKG-01",
          totalAmount: 2000000,
          content: "Lương T2",
        })
      ),
    (e) => e.code === "P1001",
    "quét id hỏng phải abort giao dịch, không dedup lệnh chi cũ"
  );

  // Store: vẫn đúng một lệnh chi GD-0001, không có bản ghi gd-fail-2, GD-0001 không cấp lại.
  assert.deepEqual(
    db.__state.payout.map((p) => p.id),
    ["GD-0001"]
  );
  assert.equal(db.__state.payout.find((p) => p.idempotencyKey === "gd-fail-2"), undefined);
  // Tiền: rollback khôi phục số dư về 9.000.000 (không mất trắng cho lệnh chi thất bại).
  assert.equal(Number(db.__state.bankAccount[0].balance), 9000000);
});

// (c) listPayslips/findPayslip: Prisma lỗi phải ném, không trả phiếu đang nằm trong memory.
test("(c) listPayslips/findPayslip ném lỗi khi Prisma lỗi, không trả phiếu memory", async () => {
  const created = await withPrisma(null, () =>
    PayrollService.generatePayslip({ employeeId: "NV-C1", month: "10-2026", baseSalary: 5000, bonus: 0, totalPenalty: 0 })
  );
  // Chứng minh memory THẬT SỰ có phiếu này (nên nếu code còn fallback là nó sẽ lộ ra).
  const inMemory = await withPrisma(null, () => PayrollService.findPayslip(created.id));
  assert.equal(inMemory.id, created.id);

  const failing = allFailingStub();
  await assert.rejects(
    () => withPrisma(failing, () => PayrollService.listPayslips({ employeeId: "NV-C1" })),
    (e) => e.code === "P1001"
  );
  await assert.rejects(
    () => withPrisma(failing, () => PayrollService.findPayslip(created.id)),
    (e) => e.code === "P1001"
  );
});

// (d) updatePayslip: ghi lỗi phải ném và KHÔNG được sửa mảng memory.
test("(d) updatePayslip lỗi khi ghi: kho memory không bị sửa đổi", async () => {
  const created = await withPrisma(null, () =>
    PayrollService.generatePayslip({ employeeId: "NV-D1", month: "11-2026", baseSalary: 1000, bonus: 0, totalPenalty: 0 })
  );
  const db = createStubDb({ payslip: [{ ...created }] });
  db.__state.update = "reject"; // đọc OK, update ném P1001
  await assert.rejects(
    () => withPrisma(db, () => PayrollService.updatePayslip(created.id, { bonus: 5000 })),
    (e) => e.code === "P1001"
  );
  // Assert TRÊN STORE memory (không chỉ trên lỗi vừa ném).
  const after = await withPrisma(null, () => PayrollService.findPayslip(created.id));
  assert.equal(Number(after.bonus), 0, "bonus memory phải giữ nguyên");
  assert.equal(Number(after.netSalary), 1000, "netSalary memory không được đổi");
});

// (d2) setPayslipStatus: ghi lỗi phải ném (memory giữ nguyên); P2025 -> null để controller 404.
test("(d2) setPayslipStatus lỗi khi ghi: memory giữ nguyên, P2025 trả null", async () => {
  const created = await withPrisma(null, () =>
    PayrollService.generatePayslip({ employeeId: "NV-D2", month: "12-2026", baseSalary: 700, bonus: 0, totalPenalty: 0 })
  );
  const db = createStubDb({ payslip: [{ ...created }] });
  db.__state.update = "reject";
  await assert.rejects(
    () => withPrisma(db, () => PayrollService.setPayslipStatus(created.id, "đã chốt")),
    (e) => e.code === "P1001"
  );
  let after = await withPrisma(null, () => PayrollService.findPayslip(created.id));
  assert.equal(after.status, "chưa chốt", "status memory không được đổi khi ghi DB thất bại");

  const db404 = createStubDb({ payslip: [{ ...created }] });
  db404.__state.update = "notfound";
  const res = await withPrisma(db404, () => PayrollService.setPayslipStatus(created.id, "đã chốt"));
  assert.equal(res, null, "P2025 (không có phiếu) phải trả null, không ném 500");
});

// listPayouts + findByIdempotencyKey (site 2 & 3): lỗi Prisma phải ném, không đọc memory.
test("listPayouts/findByIdempotencyKey ném lỗi khi Prisma lỗi, không trả dữ liệu memory", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "LIST-01", balance: 1000 }));
  await withPrisma(null, () =>
    PayrollService.createPayout({ idempotencyKey: "mem-key-1", debitAccount: "LIST-01", totalAmount: 100 })
  );
  const failing = allFailingStub();
  await assert.rejects(() => withPrisma(failing, () => PayrollService.listPayouts()), (e) => e.code === "P1001");
  await assert.rejects(
    () => withPrisma(failing, () => PayrollService.findByIdempotencyKey("mem-key-1")),
    (e) => e.code === "P1001"
  );
});

// (e) hồi quy: chế độ memory thuần (không có prisma client) vẫn tạo phiếu lương và lệnh chi.
test("(e) chế độ memory thuần vẫn tạo phiếu lương và lệnh chi, dedup đúng", async () => {
  await withPrisma(null, () => PayrollService.createBankAccount({ accountNumber: "MEMO-E", balance: 3000000 }));
  const payslip = await withPrisma(null, () =>
    PayrollService.generatePayslip({ employeeId: "NV-E1", month: "09-2026", baseSalary: 2000000, bonus: 100000, totalPenalty: 50000 })
  );
  assert.match(payslip.id, /^PL-/);
  assert.equal(payslip.netSalary, 2050000);

  const payout = await withPrisma(null, () =>
    PayrollService.createPayout({ idempotencyKey: "memo-e-1", debitAccount: "MEMO-E", totalAmount: 500000, content: "Lương T9" })
  );
  assert.equal(payout.status, "success");
  assert.match(payout.id, /^GD-/);

  const again = await withPrisma(null, () =>
    PayrollService.createPayout({ idempotencyKey: "memo-e-1", debitAccount: "MEMO-E", totalAmount: 500000 })
  );
  assert.equal(again.deduped, true, "memory mode vẫn dedup theo idempotencyKey");
});
