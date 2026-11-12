"use strict";

const http = require("node:http");
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const jwt = require("jsonwebtoken");
const request = require("supertest");
let upstream;
let app;
const secret = "gateway_proxy_test_secret";

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url.startsWith("/soap/payroll")) {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => { res.writeHead(200, { "Content-Type": "text/xml" }); res.end(body); });
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { headers: req.headers, url: req.url } }));
    }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  process.env.JWT_SECRET = secret;
  for (const key of ["IDENTITY_URL", "ORGANIZATION_URL", "INTEGRATION_URL"]) process.env[key] = target;
  app = require("../src/app");
});

after(async () => {
  if (upstream) await new Promise(resolve => upstream.close(resolve));
});

test("proxy chỉ gửi danh tính đã ký, xóa header mạo danh và token nội bộ", async () => {
  const token = jwt.sign({ userId: "user-1", employeeId: "employee-2", branchId: "branch-3", role: "manager", name: "Nguyễn Văn An" }, secret);
  const res = await request(app).get("/api/positions")
    .set("Authorization", `Bearer ${token}`)
    .set("x-user-role", "admin").set("x-user-id", "fake")
    .set("x-user-extra", "fake").set("x-employee-id", "fake")
    .set("x-branch-id", "fake").set("x-branch-slug", "legacy")
    .set("x-internal-token", "fake").expect(200);
  const headers = res.body.data.headers;
  assert.equal(headers["x-user-id"], "user-1");
  assert.equal(headers["x-employee-id"], "employee-2");
  assert.equal(headers["x-branch-id"], "branch-3");
  assert.equal(headers["x-user-role"], "manager");
  assert.equal(decodeURIComponent(headers["x-user-name"]), "Nguyễn Văn An");
  for (const key of ["x-user-extra", "x-branch-slug", "x-internal-token"]) assert.equal(headers[key], undefined);
});

test("tuyến public cũng không chuyển danh tính hoặc token nội bộ do client tự gửi", async () => {
  const res = await request(app).post("/api/auth/login").set("x-user-role", "admin")
    .set("x-internal-token", "fake").set("x-employee-id", "fake").expect(200);
  for (const key of ["x-user-role", "x-internal-token", "x-employee-id"]) assert.equal(res.body.data.headers[key], undefined);
});

test("SOAP giữ nguyên XML; archive đã loại khỏi Gateway", async () => {
  const token = jwt.sign({ userId: "admin", role: "admin" }, secret);
  const xml = '<Envelope><PayoutRequest><idempotencyKey>key-1</idempotencyKey></PayoutRequest></Envelope>';
  const res = await request(app).post("/soap/payroll").set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "text/xml").send(xml).expect(200);
  assert.match(res.headers["content-type"], /text\/xml/);
  assert.equal(res.text, xml);
  await request(app).get("/api/archive/work/tasks").set("Authorization", `Bearer ${token}`).expect(404);
});
