"use strict";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

// Test trên Postgres thật của hrm_integration (docker compose local).
const app = require("../../src/app");
const database = require("../../src/config/database");

const PREFIX = `ARCHTEST-${Date.now()}`;
const OLD = new Date(Date.now() - 400 * 24 * 3600 * 1000);
let server;
let base;
let prisma;
const json = { "Content-Type": "application/json" };

before(async () => {
  await database.connect();
  prisma = database.getPrisma();
  if (!prisma) throw new Error("Test archive cần Postgres local (docker compose up -d)");
  server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://localhost:${server.address().port}`;

  await prisma.request.createMany({
    data: [
      { id: `${PREFIX}-R1`, type: "leave", employeeId: "e-x", title: "Đơn cũ đã duyệt", content: "x", status: "approved", createdAt: OLD, updatedAt: OLD },
      { id: `${PREFIX}-R2`, type: "leave", employeeId: "e-x", title: "Đơn cũ từ chối", content: "x", status: "rejected", createdAt: OLD, updatedAt: OLD },
      { id: `${PREFIX}-R3`, type: "leave", employeeId: "e-x", title: "Đơn cũ chờ duyệt", content: "x", status: "pending", createdAt: OLD, updatedAt: OLD },
    ],
  });
  await prisma.notification.createMany({
    data: [
      // targetEmployeeId riêng để test read-all của file khác không đánh dấu đã đọc nhầm.
      { id: `${PREFIX}-N1`, targetEmployeeId: `${PREFIX}-emp`, title: "Thông báo cũ đã đọc", body: "x", isRead: true, createdAt: OLD },
      { id: `${PREFIX}-N2`, targetEmployeeId: `${PREFIX}-emp`, title: "Thông báo cũ chưa đọc", body: "x", isRead: false, createdAt: OLD },
    ],
  });
});

after(async () => {
  if (prisma) {
    await prisma.request.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.archivedRequest.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.archivedNotification.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
  }
  if (server) {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await database.disconnect();
});

async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });
  return { res, body: await res.json() };
}

test("preview đếm đúng đơn đã xử lý và thông báo đã đọc quá hạn", async () => {
  const { res, body } = await post("/api/archive/integration/preview", { months: 6 });
  assert.equal(res.status, 200);
  assert.ok(body.data.counts.request >= 2);
  assert.ok(body.data.counts.notification >= 1);
  assert.ok(body.data.cutoffDate);
});

test("preview/run chặn payload sai chuẩn", async () => {
  let r = await post("/api/archive/integration/preview", { months: 6, cutoffDate: "2025-01-01" });
  assert.equal(r.res.status, 400);
  r = await post("/api/archive/integration/preview", { months: 0 });
  assert.equal(r.res.status, 400);
  r = await post("/api/archive/integration/preview", { cutoffDate: "khong-phai-ngay" });
  assert.equal(r.res.status, 400);
  r = await post("/api/archive/integration/run", { months: 6, types: ["news"] });
  assert.equal(r.res.status, 400);
  r = await post("/api/archive/integration/run", { months: 6, limit: 3000 });
  assert.equal(r.res.status, 400);
});

test("run chuyển batch vào kho lưu trữ, đơn pending và thông báo chưa đọc giữ nguyên", async () => {
  const cutoffDate = new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString();
  let totalMoved = 0;
  // Lặp tới khi các bản ghi test rời bảng sống (không quét cạn dữ liệu seed của test khác).
  for (let i = 0; i < 20; i++) {
    const { res, body } = await post("/api/archive/integration/run", { cutoffDate, limit: 5 });
    assert.equal(res.status, 200);
    assert.ok(body.data.batchId);
    totalMoved += body.data.moved.request + body.data.moved.notification;
    const stillLive = await prisma.request.findUnique({ where: { id: `${PREFIX}-R1` } });
    const notifLive = await prisma.notification.findUnique({ where: { id: `${PREFIX}-N1` } });
    if (!stillLive && !notifLive) break;
  }
  assert.ok(totalMoved >= 3);

  assert.ok(await prisma.request.findUnique({ where: { id: `${PREFIX}-R3` } }), "đơn pending không bị archive");
  assert.ok(await prisma.notification.findUnique({ where: { id: `${PREFIX}-N2` } }), "thông báo chưa đọc không bị archive");
  assert.ok(await prisma.archivedRequest.findUnique({ where: { id: `${PREFIX}-R1` } }));
  assert.ok(await prisma.archivedNotification.findUnique({ where: { id: `${PREFIX}-N1` } }));
  assert.equal(await prisma.request.findUnique({ where: { id: `${PREFIX}-R1` } }), null);
});

test("list/detail archive trả đúng bản ghi và phân trang", async () => {
  let res = await fetch(`${base}/api/archive/integration/requests?q=${encodeURIComponent("Đơn cũ đã duyệt")}`);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.ok(body.data.items.some((r) => r.id === `${PREFIX}-R1`));

  res = await fetch(`${base}/api/archive/integration/requests/${PREFIX}-R1`);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.data.id, `${PREFIX}-R1`);
  assert.ok(body.data.archivedAt);
  assert.ok(body.data.archiveBatchId);

  res = await fetch(`${base}/api/archive/integration/requests/khong-ton-tai`);
  assert.equal(res.status, 404);
});

test("restore đưa bản ghi về bảng sống, restore lần 2 trả 404, trùng id trả 409", async () => {
  let r = await post(`/api/archive/integration/requests/${PREFIX}-R1/restore`, {});
  assert.equal(r.res.status, 200);
  assert.ok(await prisma.request.findUnique({ where: { id: `${PREFIX}-R1` } }));
  assert.equal(await prisma.archivedRequest.findUnique({ where: { id: `${PREFIX}-R1` } }), null);

  r = await post(`/api/archive/integration/requests/${PREFIX}-R1/restore`, {});
  assert.equal(r.res.status, 404);

  // Tạo lại bản ghi archive giả lập trùng id với bảng sống → 409.
  const live = await prisma.request.findUnique({ where: { id: `${PREFIX}-R1` } });
  await prisma.archivedRequest.create({
    data: { ...live, archivedAt: new Date(), archiveBatchId: "test-batch" },
  });
  r = await post(`/api/archive/integration/requests/${PREFIX}-R1/restore`, {});
  assert.equal(r.res.status, 409);
  assert.equal(r.body.error.code, "DUPLICATE_RESOURCE");
});