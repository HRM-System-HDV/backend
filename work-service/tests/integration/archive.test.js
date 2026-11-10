"use strict";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

// Test trên Postgres thật của hrm_work (docker compose local).
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

  await prisma.task.createMany({
    data: [
      { id: `${PREFIX}-T1`, title: "Nhiệm vụ cũ hoàn thành", status: "completed", createdAt: OLD, updatedAt: OLD },
      { id: `${PREFIX}-T2`, title: "Nhiệm vụ cũ đang chờ", status: "pending", createdAt: OLD, updatedAt: OLD },
    ],
  });
});

after(async () => {
  if (prisma) {
    await prisma.task.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
    await prisma.archivedTask.deleteMany({ where: { id: { startsWith: PREFIX } } }).catch(() => {});
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

test("preview đếm đúng nhiệm vụ hoàn thành quá hạn", async () => {
  const { res, body } = await post("/api/archive/work/preview", { months: 6, types: ["task"] });
  assert.equal(res.status, 200);
  assert.ok(body.data.counts.task >= 1);
});

test("payload sai chuẩn trả 400 tiếng Việt", async () => {
  let r = await post("/api/archive/work/preview", {});
  assert.equal(r.res.status, 400);
  r = await post("/api/archive/work/run", { months: 6, types: ["shift"] });
  assert.equal(r.res.status, 400);
});

test("run chuyển nhiệm vụ hoàn thành, giữ nhiệm vụ pending", async () => {
  const cutoffDate = new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString();
  let moved = 0;
  // Lặp tới khi bản ghi test rời bảng sống (không quét cạn dữ liệu của test khác).
  for (let i = 0; i < 20; i++) {
    const { res, body } = await post("/api/archive/work/run", { cutoffDate, types: ["task"], limit: 5 });
    assert.equal(res.status, 200);
    moved += body.data.moved.task;
    const stillLive = await prisma.task.findUnique({ where: { id: `${PREFIX}-T1` } });
    if (!stillLive) break;
  }
  assert.ok(moved >= 1);
  assert.ok(await prisma.archivedTask.findUnique({ where: { id: `${PREFIX}-T1` } }));
  assert.ok(await prisma.task.findUnique({ where: { id: `${PREFIX}-T2` } }), "nhiệm vụ pending không bị archive");
  assert.equal(await prisma.task.findUnique({ where: { id: `${PREFIX}-T1` } }), null);
});

test("list/detail/restore nhiệm vụ archive", async () => {
  let res = await fetch(`${base}/api/archive/work/tasks?q=${encodeURIComponent("Nhiệm vụ cũ hoàn thành")}`);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.ok(body.data.items.some((t) => t.id === `${PREFIX}-T1`));

  res = await fetch(`${base}/api/archive/work/tasks/${PREFIX}-T1`);
  assert.equal(res.status, 200);
  body = await res.json();
  assert.ok(body.data.archivedAt);

  let r = await post(`/api/archive/work/tasks/${PREFIX}-T1/restore`, {});
  assert.equal(r.res.status, 200);
  assert.ok(await prisma.task.findUnique({ where: { id: `${PREFIX}-T1` } }));

  r = await post(`/api/archive/work/tasks/${PREFIX}-T1/restore`, {});
  assert.equal(r.res.status, 404);
});