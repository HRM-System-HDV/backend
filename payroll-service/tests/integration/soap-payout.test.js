"use strict";
// Kiểm thử hợp đồng SOAP chi lương (tầng E -> tầng D) từ góc nhìn của payroll-service.
//
// Mục tiêu (Q-D-04): chứng minh có CA phủ định cho tuyến SOAP —
//   1) SOAP chi phiếu CHƯA xác nhận  => trả lỗi soap:Fault với faultcode = soap:Client (tiếng Việt).
//   2) SOAP chi phiếu ĐÃ xác nhận    => trả PayoutResponse (transactionId, bankReference) và trừ tiền đúng một lần.
//
// Cách chạy: KHÔNG import chéo mã nguồn (RULES.md §6.3) — test này chạy đúng 2 tiến trình
// thật (payroll-service của D và integration-service của E) và gọi qua HTTP.
// Chỉ mô phỏng 2 endpoint của organization/work (tầng B) bằng HTTP stub trong test để
// payroll có dữ liệu chấm công và hồ sơ lương.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const goc = path.resolve(__dirname, "..", "..", "..");
const thuMucPayroll = path.join(goc, "payroll-service");
const thuMucIntegration = path.join(goc, "integration-service");
const token = "kiem_thu_soap_token_noi_bo";
const tienDich = [];
let lyDoBoQua = "";

async function congTrong() {
  return new Promise(resolve => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
function doiTienDich(ten, bien) { tienDich.push({ ten, bien }); }
function batDau(ten, thuMuc, bien, env) {
  const child = spawn(process.execPath, ["server.js"], { cwd: thuMuc, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const state = { ten, child, output: "" };
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { state.output = (state.output + chunk.toString()).slice(-8000); });
  doiTienDich(ten, state);
  return state;
}
async function choKhoiDong(state, url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (state.child.exitCode !== null) throw new Error(`${state.ten} đã thoát: ${state.output}`);
    try { if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${state.ten} không khởi động được: ${state.output}`);
}
// Stub tầng B: hồ sơ nhân sự (salary/salaryType/standardWorkDays) và chấm công.
function stubTinhDich() {
  const nhanVien = { id: randomUUID(), branchId: randomUUID(), salaryType: "monthly", salary: "7800000", standardWorkDays: 26 };
  const cong = [{ employeeId: nhanVien.id, shiftId: randomUUID(), checkIn: "2026-11-01T00:00:00Z", checkOut: "2026-11-01T05:00:00Z", penaltyAmount: "0" }];
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/api/employees/")) return res.end(JSON.stringify({ data: nhanVien }));
    if (req.url.startsWith("/api/attendance")) return res.end(JSON.stringify({ data: cong }));
    res.statusCode = 404; res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Không có" } }));
  });
  return { server, nhanVien, cong };
}
async function startStub() {
  const stub = stubTinhDich();
  await new Promise(resolve => stub.server.listen(0, "127.0.0.1", resolve));
  const port = stub.server.address().port;
  return { stub, orgUrl: `http://127.0.0.1:${port}`, workUrl: `http://127.0.0.1:${port}` };
}

let congOrg = null, congWork = null, trangPayroll = null, trangIntegration = null, congPayroll = null, congIntegration = null, tempDir = null;

before(async () => {
  if (!fs.existsSync(path.join(thuMucIntegration, "server.js")) || !fs.existsSync(path.join(thuMucIntegration, "node_modules"))) {
    lyDoBoQua = "Không tìm thấy integration-service (tầng E) — bỏ qua kiểm thử SOAP.";
    return;
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hrm-soap-payroll-"));
  const org = await startStub();
  congOrg = org.stub; congWork = org.stub;
  const orgPort = org.orgUrl.split(":").pop();
  const congOrgUrl = `http://127.0.0.1:${orgPort}`;
  const congPayrollPort = await congTrong();
  const congIntegrationPort = await congTrong();
  const urlPayroll = `http://127.0.0.1:${congPayrollPort}`;
  const urlIntegration = `http://127.0.0.1:${congIntegrationPort}`;
  trangPayroll = batDau("payroll-service", thuMucPayroll, null, {
    PORT: String(congPayrollPort), NODE_ENV: "test", SERVICE_NAME: "payroll-service", DATABASE_URL: "",
    ORGANIZATION_URL: congOrgUrl, WORK_URL: congOrgUrl, INTERNAL_API_TOKEN: token,
  });
  trangIntegration = batDau("integration-service", thuMucIntegration, null, {
    PORT: String(congIntegrationPort), NODE_ENV: "test", SERVICE_NAME: "integration-service", DATABASE_URL: "",
    PAYROLL_SERVICE_URL: urlPayroll, INTERNAL_API_TOKEN: token, STORAGE_DIR: tempDir, PUBLIC_BASE_URL: urlIntegration,
  });
  await choKhoiDong(trangPayroll, urlPayroll);
  await choKhoiDong(trangIntegration, urlIntegration);
  congPayroll = urlPayroll; congIntegration = urlIntegration;
});

after(async () => {
  await Promise.all(tienDich.map(({ bien }) => new Promise(resolve => { if (!bien || !bien.child || bien.child.exitCode !== null) return resolve(); bien.child.once("exit", resolve); bien.child.kill(); })));
  if (congOrg) await new Promise(resolve => congOrg.server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

const admin = { "x-user-id": randomUUID(), "x-user-role": "admin" };
async function goiPayroll(method, duongDan, body) {
  const res = await fetch(`${congPayroll}/api${duongDan}`, {
    method, headers: { ...admin, "Content-Type": "application/json", "x-internal-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  return { status: res.status, json };
}
function xmlSoap(idempotencyKey, debitAccount, totalAmount, payslipIds) {
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><PayoutRequest>` +
    `<idempotencyKey>${idempotencyKey}</idempotencyKey><debitAccount>${debitAccount}</debitAccount>` +
    `<content>Chi lương qua SOAP</content><totalAmount>${totalAmount}</totalAmount><beneficiaryCount>1</beneficiaryCount>` +
    payslipIds.map(id => `<payslipId>${id}</payslipId>`).join("") +
    `</PayoutRequest></soap:Body></soap:Envelope>`;
}
async function goiSoap(xml) {
  const res = await fetch(`${congIntegration}/soap/payroll`, { method: "POST", headers: { ...admin, "Content-Type": "text/xml" }, body: xml, signal: AbortSignal.timeout(15000) });
  return { status: res.status, body: await res.text(), loai: res.headers.get("content-type") || "" };
}

test("SOAP: chi phiếu CHƯA xác nhận => soap:Fault (soap:Client, tiếng Việt); chi phiếu ĐÃ xác nhận => PayoutResponse và trừ tiền đúng một lần", { timeout: 90000 }, async (t) => {
  if (!congIntegration) return t.skip(lyDoBoQua || "Bỏ qua: không khởi động được hai service");
  // Chuẩn bị: tài khoản nguồn + phiếu lương chưa xác nhận.
  const soTaiKhoan = `SOAP-${randomUUID()}`;
  const taiKhoan = await goiPayroll("POST", "/payroll/bank-accounts", { accountNumber: soTaiKhoan, accountName: "HRM", bankName: "Test", balance: "1000000" });
  assert.equal(taiKhoan.status, 201, JSON.stringify(taiKhoan.json));
  const phieu = await goiPayroll("POST", "/payroll/payslips/generate", { employeeId: congOrg.nhanVien.id, month: "2026-11" });
  assert.equal(phieu.status, 201, JSON.stringify(phieu.json));
  const thucLinh = String(phieu.json.data.netSalary);
  assert.equal(thucLinh, "300000");

  // (1) CA PHỦ ĐỊNH: chi phiếu CHƯA xác nhận => soap:Fault, faultcode = soap:Client.
  const loi = await goiSoap(xmlSoap(randomUUID(), soTaiKhoan, thucLinh, [phieu.json.data.id]));
  assert.match(loi.loai, /xml/);
  assert.match(loi.body, /<soap:Fault>/, "SOAP phải trả soap:Fault khi chiếu lỗi");
  assert.match(loi.body, /<faultcode>soap:Client<\/faultcode>/);
  assert.doesNotMatch(loi.body, /PayoutResponse/);
  assert.match(loi.body, /<faultstring>[^<]*xác nhận[^<]*<\/faultstring>/, `faultstring phải mô tả lỗi tiếng Việt: ${loi.body}`);
  const truoc = await goiPayroll("GET", "/payroll/bank-accounts");
  assert.equal(String(truoc.json.data.find(row => row.accountNumber === soTaiKhoan).balance), "1000000", "Lỗi SOAP không được trừ tiền");

  // (2) CA DƯƠNG: xác nhận phiếu rồi chi qua SOAP => PayoutResponse.
  const xacNhan = await goiPayroll("POST", `/payroll/payslips/${phieu.json.data.id}/confirm`, {});
  assert.equal(xacNhan.status, 200, JSON.stringify(xacNhan.json));
  const khoa = randomUUID();
  const thanhCong = await goiSoap(xmlSoap(khoa, soTaiKhoan, thucLinh, [phieu.json.data.id]));
  assert.equal(thanhCong.status, 200, thanhCong.body);
  assert.match(thanhCong.body, /PayoutResponse/);
  assert.doesNotMatch(thanhCong.body, /Fault/);
  assert.match(thanhCong.body, /<bankReference>GD-\d{6,}<\/bankReference>/);
  assert.match(thanhCong.body, /<transactionId>[0-9a-f-]{36}<\/transactionId>/);
  const sau = await goiPayroll("GET", "/payroll/bank-accounts");
  assert.equal(String(sau.json.data.find(row => row.accountNumber === soTaiKhoan).balance), "700000", "SOAP chi thành công phải trừ đúng số tiền");

  // (3) Gửi lại CÙNG idempotencyKey => không trừ tiền lần hai.
  const trung = await goiSoap(xmlSoap(khoa, soTaiKhoan, thucLinh, [phieu.json.data.id]));
  assert.equal(trung.status, 200, trung.body);
  assert.match(trung.body, /PayoutResponse/);
  const sauTrung = await goiPayroll("GET", "/payroll/bank-accounts");
  assert.equal(String(sauTrung.json.data.find(row => row.accountNumber === soTaiKhoan).balance), "700000", "Gửi lại cùng lệnh chi không được trừ tiền lần hai");
});
