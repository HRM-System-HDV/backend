"use strict";

// Phải set trước khi require: dotenv không ghi đè biến đã tồn tại trong
// process.env, nên DATABASE_URL="" ép service chạy kho in-memory và test
// không ghi lên Postgres dev.
process.env.DATABASE_URL = "";

const assert = require("node:assert/strict");
const http = require("node:http");
const { test, describe } = require("node:test");

const config = require("../../src/config");
const RequestService = require("../../src/services/RequestService");

function startShiftMock(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      calls.push({ shiftId: req.url.split("/").pop(), body: JSON.parse(raw || "{}") });
      const [status, payload] = handler(req, res);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      config.workServiceUrl = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, calls });
    });
  });
}

async function createSwapRequest(id) {
  return RequestService.create({
    id,
    type: "shift_swap",
    employeeId: "e-swap-a",
    targetEmployeeId: "e-swap-b",
    title: "Đổi ca thứ Bảy",
    content: "Em đổi ca cho anh Bình",
    sourceShiftId: "sh-a",
    targetShiftId: "sh-b",
    branchSlug: "cn01",
  });
}

describe("Duyệt đơn đổi ca đồng bộ sang work-service", () => {
  test("hoán đổi hai chiều: ca nguồn sang người được nhờ, ca đích sang người gửi", async () => {
    const { server, calls } = await startShiftMock(() => [200, { data: { id: "ok" } }]);
    try {
      const row = await createSwapRequest("REQ-SWAP-1");
      await RequestService.approveRequest(row.id, { reviewedBy: "mgr-1" });

      assert.equal(calls.length, 2, "phải gọi updateShift cho cả hai ca");
      assert.deepEqual(
        calls.map((c) => [c.shiftId, c.body.employeeId]).sort(),
        [["sh-a", "e-swap-b"], ["sh-b", "e-swap-a"]]
      );
      const after = await RequestService.findById(row.id);
      assert.equal(after.status, "approved");
    } finally {
      server.close();
    }
  });

  test("work-service lỗi: đơn ở lại pending để duyệt lại, không có approved nửa vời", async () => {
    const { server } = await startShiftMock(() => [500, { error: { message: "lỗi" } }]);
    try {
      const row = await createSwapRequest("REQ-SWAP-2");
      await assert.rejects(
        () => RequestService.approveRequest(row.id, { reviewedBy: "mgr-1" }),
        /HTTP 500/
      );
      const after = await RequestService.findById(row.id);
      assert.equal(after.status, "pending", "đơn đã bị đánh dấu duyệt dù ca chưa đổi");
    } finally {
      server.close();
    }
  });

  test("từ chối đơn không gọi sang work-service", async () => {
    const { server, calls } = await startShiftMock(() => [200, {}]);
    try {
      const row = await createSwapRequest("REQ-SWAP-3");
      await RequestService.rejectRequest(row.id, { reviewedBy: "mgr-1" });
      assert.equal(calls.length, 0);
    } finally {
      server.close();
    }
  });

  test("nửa hoán đổi được hoàn tác: ca nguồn về chủ cũ khi ca đích lỗi", async () => {
    let n = 0;
    const { server, calls } = await startShiftMock(() => {
      n += 1;
      return n === 2 ? [500, { error: { message: "chập" } }] : [200, {}];
    });
    try {
      const row = await createSwapRequest("REQ-SWAP-4");
      await assert.rejects(() => RequestService.approveRequest(row.id, { reviewedBy: "mgr-1" }));
      assert.deepEqual(
        calls.map((c) => [c.shiftId, c.body.employeeId]),
        [["sh-a", "e-swap-b"], ["sh-b", "e-swap-a"], ["sh-a", "e-swap-a"]],
        "phải gọi bù trả ca nguồn về người gửi"
      );
      const after = await RequestService.findById(row.id);
      assert.equal(after.status, "pending");
    } finally {
      server.close();
    }
  });
});
