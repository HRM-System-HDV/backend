"use strict";

// DATABASE_URL="" phải set TRƯỚC khi require: dotenv không ghi đè biến đã có,
// nên cách này ép service dùng kho in-memory và test không chạm Postgres dev.
process.env.DATABASE_URL = "";

const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");

const SoapConfigService = require("../../src/services/SoapConfigService");

function startServer(status, body) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(status, { "Content-Type": "text/xml" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${server.address().port}/soap/payroll?wsdl`,
      });
    });
  });
}

async function withTarget(url, fn) {
  await SoapConfigService.updateConfig({ wsdlUrl: url, endpointUrl: url });
  return fn();
}

test("pingGateway: endpoint 200 -> healthy, responseTime đo thật", async () => {
  const target = await startServer(200, "<definitions/>");
  try {
    const result = await withTarget(target.url, () => SoapConfigService.pingGateway());
    assert.equal(result.status, "healthy");
    assert.match(result.responseTime, /^\d+ms$/);
    assert.equal(result.error, null);
    assert.equal(target.requests.length, 1, "phải gọi HTTP thật tới wsdlUrl");
    assert.equal(result.config.avgResponseTime, result.responseTime);
    assert.equal(result.config.status, "healthy");
  } finally {
    target.server.close();
  }
});

test("pingGateway: endpoint 500 -> degraded, không báo healthy", async () => {
  const target = await startServer(500, "boom");
  try {
    const result = await withTarget(target.url, () => SoapConfigService.pingGateway());
    assert.equal(result.status, "degraded");
    assert.equal(result.httpStatus, 500);
    assert.equal(result.error, "Endpoint trả HTTP 500");
    const cfg = await SoapConfigService.getConfig();
    assert.equal(cfg.status, "degraded", "trạng thái sai phải được ghi lại, không giữ 'healthy'");
  } finally {
    target.server.close();
  }
});

test("pingGateway: không nối được -> down", async () => {
  // Port 1 đóng: fetch thất bại ngay (ECONNREFUSED), không chờ timeout.
  const result = await withTarget("http://127.0.0.1:1/soap/payroll?wsdl", () =>
    SoapConfigService.pingGateway()
  );
  assert.equal(result.status, "down");
  assert.equal(result.httpStatus, null);
  assert.match(result.error, /ECONNREFUSED|connect|Failed to fetch|fetch failed/i);
});

test("pingGateway: chưa cấu hình endpoint -> unknown, không bịa số liệu", async () => {
  await SoapConfigService.updateConfig({ wsdlUrl: "", endpointUrl: "" });
  const result = await SoapConfigService.pingGateway();
  assert.equal(result.status, "unknown");
  assert.equal(result.responseTime, null);
  assert.equal(result.config.avgResponseTime, null);
});

test("pingGateway: nhiều lần đo cho responseTime khác nhau (không phải hằng số bịa)", async () => {
  const target = await startServer(200, "<definitions/>");
  try {
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await withTarget(target.url, () => SoapConfigService.pingGateway());
      seen.push(Number.parseInt(result.responseTime, 10));
    }
    assert.equal(target.requests.length, 3, "mỗi lần ping phải là một request thật");
    seen.forEach((v) => assert.ok(Number.isFinite(v) && v >= 0));
  } finally {
    target.server.close();
  }
});
