"use strict";

// Q-A-01 / Q-A-03: Gateway là nguồn tin cậy duy nhất của nền tảng client và IP.
// Test ở đây kiểm tra HỢP ĐỒNG giữa Gateway và identity-service:
//   - Gateway xóa header giả mạo của client và tự tính nền tảng.
//   - Service phía sau nhận header đã chuẩn hóa + IP thật của socket.
const http = require("node:http");
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const request = require("supertest");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA = "Dart/3.4 (dart:io)";

let upstream;
let app;

before(async () => {
  upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      // Mô phỏng đúng luật của identity-service: nền tảng lấy từ header
      // x-client-platform trước, body chỉ là fallback; nhân viên chỉ được
      // đăng nhập khi nền tảng là mobile.
      const platform = req.headers["x-client-platform"] || body.clientPlatform || "web";
      if (body.role === "staff" && platform !== "mobile") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "FORBIDDEN", message: "Nhân viên chỉ được đăng nhập trên Mobile" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { headers: req.headers, body, platform } }));
    });
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  process.env.JWT_SECRET = "gateway_client_context_secret";
  process.env.IDENTITY_URL = target;
  app = require("../src/app");
});

after(async () => {
  if (upstream) await new Promise(resolve => upstream.close(resolve));
});

test("Gateway ghi đè header x-client-platform của client và tự tính nền tảng web", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", BROWSER_UA)
    .set("Origin", "http://localhost:3000")
    .set("x-client-platform", "mobile")
    .set("x-client-ip", "10.9.9.9")
    .set("x-forwarded-for", "8.8.8.8")
    .send({ email: "a@b.c", password: "x", clientPlatform: "mobile" })
    .expect(200);
  const headers = res.body.data.headers;
  assert.equal(headers["x-client-platform"], "web");
  // IP lấy từ socket thật của gateway, không phải IP client tự khai.
  assert.equal(headers["x-client-ip"], "127.0.0.1");
  assert.equal(headers["x-forwarded-for"], undefined);
});

test("body clientPlatform=mobile bị Gateway ghi đè khi request đến từ trình duyệt", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", BROWSER_UA)
    .send({ email: "a@b.c", password: "x", clientPlatform: "mobile" })
    .expect(200);
  // Header chuẩn hóa là "web" nên service phía sau bỏ qua giá trị body.
  assert.equal(res.body.data.platform, "web");
  assert.equal(res.body.data.body.clientPlatform, "mobile");
});

test("browser giả header x-client-platform=mobile vẫn bị chặn đăng nhập staff", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", BROWSER_UA)
    .set("Origin", "http://localhost:3000")
    .set("x-client-platform", "mobile")
    .send({ email: "nhanvien@example.test", password: "x", role: "staff", clientPlatform: "mobile" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "FORBIDDEN");
});

test("ứng dụng mobile (không Origin, UA không phải trình duyệt) được gán nền tảng mobile", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", MOBILE_UA)
    .set("x-device-name", "iPhone")
    .send({ email: "a@b.c", password: "x" })
    .expect(200);
  const headers = res.body.data.headers;
  assert.equal(headers["x-client-platform"], "mobile");
  assert.equal(headers["x-client-ip"], "127.0.0.1");
  assert.equal(headers["x-device-name"], "iPhone");
});

test("Origin không rỗng là dấu hiệu trình duyệt dù UA không khớp mẫu", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", "curl/8.4.0")
    .set("Origin", "http://localhost:3000")
    .send({ email: "a@b.c", password: "x" })
    .expect(200);
  assert.equal(res.body.data.headers["x-client-platform"], "web");
});

test("IP lấy từ socket của gateway, không tin x-forwarded-for của client", async () => {
  const res = await request(app).post("/api/auth/login")
    .set("User-Agent", MOBILE_UA)
    .set("x-forwarded-for", "1.2.3.4, 5.6.7.8")
    .send({ email: "a@b.c", password: "x" })
    .expect(200);
  assert.equal(res.body.data.headers["x-forwarded-for"], undefined);
  assert.equal(res.body.data.headers["x-client-ip"], "127.0.0.1");
});
