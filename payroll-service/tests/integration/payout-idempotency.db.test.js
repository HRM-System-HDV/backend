"use strict";
// Kiểm thử idempotency / số dư / bankReference với PostgreSQL THẬT của payroll-service (hrm_payroll).
//
// BỎ QUA (skip) rõ ràng khi chưa có DB: không có DATABASE_URL, PostgreSQL không chạy
// (Docker đang tắt) hoặc bảng chưa được migrate. Test KHÔNG tự chạy migration và
// KHÔNG chạm vào DB của service khác (RULES.md §6).
//
// Cách chạy:
//   cd backend/payroll-service
//   npm run test:db              # chỉ chạy file này
//   npm test                     # file này nằm trong tests/integration nên cũng được chạy (tự skip nếu thiếu DB)
// Yêu cầu: PostgreSQL của payroll-service đã chạy VÀ đã `npx prisma migrate deploy`.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("supertest");
const config = require("../../src/config");
const database = require("../../src/config/database");
const app = require("../../src/app");

let db = null;
let lyDoBoQua = "";
const daTao = { taiKhoan: [], phieu: [], lenhChi: [] };
let thang = 0;
const admin = { "x-user-id": randomUUID(), "x-user-role": "admin" };

before(async () => {
  if (!config.databaseUrl) { lyDoBoQua = "Không có DATABASE_URL — cần PostgreSQL của payroll-service (docker compose up -d) và đã migrate."; return; }
  try {
    await database.connect();
    db = database.getPrisma();
    await db.payslip.count(); // bảng phải tồn tại (đã migrate) mới chạy được
  } catch (error) {
    db = null;
    lyDoBoQua = `PostgreSQL chưa sẵn sàng: ${error.message}`;
  }
});

after(async () => {
  if (db) {
    if (daTao.phieu.length) await db.payslip.deleteMany({ where: { id: { in: daTao.phieu } } });
    if (daTao.lenhChi.length) await db.payout.deleteMany({ where: { id: { in: daTao.lenhChi } } });
    if (daTao.taiKhoan.length) await db.bankAccount.deleteMany({ where: { id: { in: daTao.taiKhoan } } });
  }
  await database.disconnect();
});

async function taoTaiKhoan(soDu) {
  const row = await db.bankAccount.create({ data: { id: randomUUID(), accountNumber: `TEST-${randomUUID()}`, accountName: "Kiểm thử", bankName: "Test", balance: String(soDu), isPrimary: false } });
  daTao.taiKhoan.push(row.id);
  return row;
}
// Phiếu đã xác nhận (đúng ràng buộc CHECK của DB: đã xác nhận thì phải có confirmedBy/confirmedAt).
async function taoPhieuXacNhan(thucLinh, base = thucLinh, phat = "0") {
  thang = (thang % 12) + 1;
  const row = await db.payslip.create({ data: { id: randomUUID(), employeeId: randomUUID(), month: `2027-${String(thang).padStart(2, "0")}`, baseSalary: String(base), bonus: "0", totalPenalty: String(phat), netSalary: String(thucLinh), salaryType: "monthly", salaryRate: "1000000", workedHours: null, status: "confirmed", confirmedBy: randomUUID(), confirmedAt: new Date(), branchId: null } });
  daTao.phieu.push(row.id);
  return row;
}
async function choPhepLenhChi0() {
  const rows = await db.$queryRaw`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'payout_amounts_valid'`;
  if (!rows.length) return true;
  // pg_get_constraintdef trả về dạng: CHECK ((("totalAmount" >= (0)::numeric) AND ...))
  return /totalAmount"?\s*>=\s*\(?0\)?(?:::numeric)?/i.test(rows[0].def);
}

test("GET phiếu lương chỉ ĐỌC: không ghi DB và không gọi Org/Work (Org/Work không chạy trong test này)", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  const phieu = await taoPhieuXacNhan("300000");
  const truoc = JSON.parse(JSON.stringify(await db.payslip.findUnique({ where: { id: phieu.id } })));
  // Organization/Work KHÔNG chạy trong test này: nếu GET gọi sang hai service này thì sẽ 500.
  const chiTiet = await request(app).get(`/api/payroll/payslips/${phieu.id}`).set(admin).expect(200);
  assert.equal(chiTiet.body.data.id, phieu.id);
  assert.equal(String(chiTiet.body.data.baseSalary), "300000");
  const danhSach = await request(app).get("/api/payroll/payslips").set(admin).expect(200);
  assert.ok(Array.isArray(danhSach.body.data));
  const sau = JSON.parse(JSON.stringify(await db.payslip.findUnique({ where: { id: phieu.id } })));
  assert.deepEqual(sau, truoc, "GET không được ghi lại dữ liệu phiếu lương");
});

test("gửi cùng idempotencyKey hai lần: lần 2 trả bản ghi cũ + deduped, không trừ tiền lần 2", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  const taiKhoan = await taoTaiKhoan("1000000");
  const phieu = await taoPhieuXacNhan("300000");
  const input = { payslipIds: [phieu.id], debitAccountId: taiKhoan.id, idempotencyKey: randomUUID(), content: "Chi lương kiểm thử" };
  const lanMot = await request(app).post("/api/payroll/payouts").set(admin).send(input).expect(201);
  const lanHai = await request(app).post("/api/payroll/payouts").set(admin).send(input).expect(200);
  assert.equal(lanHai.body.data.id, lanMot.body.data.id);
  assert.equal(lanHai.body.data.deduped, true);
  const taiKhoanSau = await db.bankAccount.findUnique({ where: { id: taiKhoan.id } });
  assert.equal(Number(taiKhoanSau.balance), 700000, "Chỉ trừ tiền một lần");
  assert.equal(await db.payout.count({ where: { idempotencyKey: input.idempotencyKey } }), 1);
  daTao.lenhChi.push(lanMot.body.data.id);
});

test("hai lệnh chi chạy đồng thời (Promise.all) với cùng idempotencyKey chỉ trừ tiền một lần", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  const taiKhoan = await taoTaiKhoan("1000000");
  const phieu = await taoPhieuXacNhan("300000");
  const input = { payslipIds: [phieu.id], debitAccountId: taiKhoan.id, idempotencyKey: randomUUID(), content: "Chi lương chạy song song" };
  const [a, b] = await Promise.all([
    request(app).post("/api/payroll/payouts").set(admin).send(input),
    request(app).post("/api/payroll/payouts").set(admin).send(input),
  ]);
  const moi = [a, b].filter(r => r.status === 201);
  const trung = [a, b].filter(r => r.status === 200);
  assert.equal(moi.length, 1, `Kỳ vọng đúng 1 lệnh chi mới, nhận ${JSON.stringify([a.status, b.status])} — ${a.body?.error?.message || ""} / ${b.body?.error?.message || ""}`);
  assert.equal(trung.length, 1, `Kỳ vọng đúng 1 lệnh chi trùng (deduped), nhận ${JSON.stringify([a.status, b.status])}`);
  assert.equal(trung[0].body.data.id, moi[0].body.data.id);
  assert.equal(trung[0].body.data.deduped, true);
  const taiKhoanSau = await db.bankAccount.findUnique({ where: { id: taiKhoan.id } });
  assert.equal(Number(taiKhoanSau.balance), 700000, "Hai lệnh chi chạy song song chỉ trừ tiền một lần");
  assert.equal(await db.payout.count({ where: { idempotencyKey: input.idempotencyKey } }), 1);
  daTao.lenhChi.push(moi[0].body.data.id);
});

test("số dư không đủ trả HTTP 422 với mã INSUFFICIENT_FUNDS và không tạo lệnh chi", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  const taiKhoan = await taoTaiKhoan("1");
  const phieu = await taoPhieuXacNhan("300000");
  const input = { payslipIds: [phieu.id], debitAccountId: taiKhoan.id, idempotencyKey: randomUUID(), content: "Thiếu số dư" };
  const res = await request(app).post("/api/payroll/payouts").set(admin).send(input).expect(422);
  assert.equal(res.body.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(res.body.error.message, "Số dư không đủ");
  assert.equal(await db.payout.count({ where: { idempotencyKey: input.idempotencyKey } }), 0);
  const phieuSau = await db.payslip.findUnique({ where: { id: phieu.id } });
  assert.equal(phieuSau.status, "confirmed"); assert.equal(phieuSau.payoutId, null);
  const taiKhoanSau = await db.bankAccount.findUnique({ where: { id: taiKhoan.id } });
  assert.equal(Number(taiKhoanSau.balance), 1);
});

test("bankReference có tiền tố GD-, sinh từ sequence Postgres và không trùng", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  const taiKhoan = await taoTaiKhoan("10000000");
  const refs = [];
  for (let i = 0; i < 3; i++) {
    const phieu = await taoPhieuXacNhan("100000");
    const res = await request(app).post("/api/payroll/payouts").set(admin).send({ payslipIds: [phieu.id], debitAccountId: taiKhoan.id, idempotencyKey: randomUUID(), content: `Mã lệnh chi ${i}` }).expect(201);
    refs.push(res.body.data.bankReference);
    daTao.lenhChi.push(res.body.data.id);
  }
  refs.forEach(ref => assert.match(ref, /^GD-\d{6,}$/, `bankReference phải có tiền tố GD- và phần số: ${ref}`));
  assert.equal(new Set(refs).size, refs.length, "bankReference không được trùng");
  const seq = await db.$queryRaw`SELECT last_value FROM payout_ref_seq`;
  assert.ok(seq.length, "Thiếu sequence payout_ref_seq trong DB — migration chưa được áp dụng?");
  assert.ok(Number(seq[0].last_value) >= Number(refs[refs.length - 1].slice(3)), "bankReference phải lấy từ sequence payout_ref_seq");
});

test("lệnh chi 0đ đóng được phiếu có thực lĩnh bằng 0 mà không trừ tiền (Q-D-02)", async (t) => {
  if (!db) return t.skip(lyDoBoQua || "Bỏ qua: chưa có PostgreSQL thật");
  if (!await choPhepLenhChi0()) return t.skip("Ràng buộc payout_amounts_valid của DB chưa cho phép totalAmount = 0 — cần chạy `npx prisma migrate deploy` trong payroll-service.");
  const taiKhoan = await taoTaiKhoan("500000");
  const phieu = await taoPhieuXacNhan("0", "0", "0");
  const res = await request(app).post("/api/payroll/payouts").set(admin).send({ payslipIds: [phieu.id], debitAccountId: taiKhoan.id, idempotencyKey: randomUUID(), content: "Đóng phiếu 0đ" }).expect(201);
  assert.equal(String(res.body.data.totalAmount), "0");
  daTao.lenhChi.push(res.body.data.id);
  const taiKhoanSau = await db.bankAccount.findUnique({ where: { id: taiKhoan.id } });
  assert.equal(Number(taiKhoanSau.balance), 500000, "Lệnh chi 0đ không được trừ tiền");
  const phieuSau = await db.payslip.findUnique({ where: { id: phieu.id } });
  assert.equal(phieuSau.status, "paid");
});
