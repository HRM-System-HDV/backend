"use strict";

// Q-A-04: tuyến SOAP (/soap/*) phải trả lỗi dạng XML <soap:Fault>, giữ status
// code; các tuyến khác giữ envelope JSON { error: { code, message } } (RULES.md §5).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const secret = "gateway_soap_error_secret";
let app;

before(async () => {
  process.env.JWT_SECRET = secret;
  // Cổng 1 không có gì lắng nghe -> proxy báo lỗi mạng -> gateway trả 502.
  process.env.INTEGRATION_URL = "http://127.0.0.1:1";
  app = require("../src/app");
});

function assertSoapFault(res, status, faultCode) {
  assert.equal(res.status, status);
  assert.match(res.headers["content-type"], /text\/xml/);
  assert.match(res.text, /<soap:Fault>/);
  assert.match(res.text, new RegExp(`<faultcode>${faultCode}</faultcode>`));
}

test("tuyến SOAP không tìm thấy trả soap:Fault (soap:Client) dạng XML", async () => {
  const token = jwt.sign({ userId: "u-1", role: "admin", clientPlatform: "web" }, secret);
  const res = await request(app).get("/soap/khong-co").set("Authorization", `Bearer ${token}`);
  assertSoapFault(res, 404, "soap:Client");
  assert.match(res.text, /<faultstring>[^<]+<\/faultstring>/);
});

test("thiếu token trên tuyến SOAP trả soap:Fault (soap:Client) thay vì JSON", async () => {
  const res = await request(app).post("/soap/payroll")
    .set("Content-Type", "text/xml")
    .send("<Envelope/>");
  assertSoapFault(res, 401, "soap:Client");
});

test("không đủ quyền trên tuyến SOAP trả soap:Fault (soap:Client)", async () => {
  const token = jwt.sign({ userId: "u-1", role: "manager", clientPlatform: "web" }, secret);
  const res = await request(app).post("/soap/payroll")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "text/xml")
    .send("<Envelope/>");
  assertSoapFault(res, 403, "soap:Client");
});

test("lỗi kết nối service phía sau trên tuyến SOAP trả soap:Fault (soap:Server)", async () => {
  const token = jwt.sign({ userId: "u-1", role: "admin", clientPlatform: "web" }, secret);
  const res = await request(app).post("/soap/payroll")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "text/xml")
    .send("<Envelope/>");
  assertSoapFault(res, 502, "soap:Server");
});

test("staff dùng token mobile nhưng request từ trình duyệt: 403 và là soap:Fault trên /soap/*", async () => {
  // Q-A-06 trên tuyến SOAP: luật nền tảng phải chạy TRƯỚC phân quyền và vẫn giữ
  // khuôn XML (không được rơi về envelope JSON).
  const token = jwt.sign({ userId: "u-1", employeeId: "e-1", role: "staff", clientPlatform: "mobile" }, secret);
  const res = await request(app)
    .post("/soap/payroll")
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost:3000")
    .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    .set("Content-Type", "text/xml")
    .send("<Envelope><Body><PayoutRequest/></Body></Envelope>");
  assertSoapFault(res, 403, "soap:Client");
  assert.match(res.text, /Nhân viên chỉ được đăng nhập trên ứng dụng Mobile/);
});

test("tuyến không phải SOAP vẫn trả envelope JSON đúng RULES.md §5.2", async () => {
  const token = jwt.sign({ userId: "u-1", role: "admin", clientPlatform: "web" }, secret);
  const res = await request(app).get("/api/khong-co").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 404);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.equal(typeof res.body.error.message, "string");
});
