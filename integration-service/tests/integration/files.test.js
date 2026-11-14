"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");

// Cô lập: thư mục tạm + chế độ in-memory (không phụ thuộc Postgres).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hrm-files-test-"));
process.env.STORAGE_DIR = tmpDir;
process.env.DATABASE_URL = "";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

let server;
let base;
const json = { "Content-Type": "application/json" };

before(async () => {
  const app = require("../../src/app");
  server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  if (server) {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function upload(folder = "hrm/avatars") {
  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ file: PNG_DATA_URL, folder }),
  });
  return { res, body: await res.json() };
}

test("POST /api/upload giữ nguyên contract, lưu file nội bộ", async () => {
  const { res, body } = await upload();
  assert.equal(res.status, 200);
  for (const key of ["url", "secure_url", "publicId", "public_id", "format", "width", "height", "bytes"]) {
    assert.ok(key in body.data, `thiếu trường ${key}`);
  }
  assert.match(body.data.url, /\/api\/files\/hrm\/avatars\/[A-Za-z0-9-]+$/);
  assert.equal(body.data.format, "png");
  assert.ok(body.data.bytes > 0);
  assert.ok(fs.existsSync(path.join(tmpDir, `${body.data.publicId}.png`)));
});

test("GET /api/files trả đúng nội dung ảnh", async () => {
  const { body } = await upload();
  const res = await fetch(`${base}/api/files/${body.data.publicId}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(buf, Buffer.from(PNG_BASE64, "base64"));
});

test("GET /api/files chặn traversal và file không tồn tại", async () => {
  let res = await fetch(`${base}/api/files/hrm/..%2F..%2Fetc%2Fpasswd`);
  assert.ok([400, 404].includes(res.status));
  res = await fetch(`${base}/api/files/hrm/khong-ton-tai`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_FOUND");
});

test("POST /api/upload chặn payload giả mạo và folder lạ", async () => {
  const fake = Buffer.from("khong phai anh").toString("base64");
  let res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ file: `data:image/png;base64,${fake}` }),
  });
  assert.equal(res.status, 400);
  let body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");

  res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ file: PNG_DATA_URL, folder: "hrm/../etc" }),
  });
  assert.equal(res.status, 400);

  res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("DELETE /api/files xóa file, GET lại trả 404, DELETE lần 2 idempotent", async () => {
  const { body } = await upload();
  const publicId = body.data.publicId;
  let res = await fetch(`${base}/api/files/${publicId}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(tmpDir, `${publicId}.png`)));

  res = await fetch(`${base}/api/files/${publicId}`);
  assert.equal(res.status, 404);

  res = await fetch(`${base}/api/files/${publicId}`, { method: "DELETE" });
  assert.equal(res.status, 404);
});

test("scan-orphans phát hiện file lạ, purge-orphans chỉ xóa danh sách được duyệt", async () => {
  // File lạ trên đĩa không có trong đăng ký.
  fs.mkdirSync(path.join(tmpDir, "hrm"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "hrm", "mo-coi.png"), Buffer.from(PNG_BASE64, "base64"));

  let res = await fetch(`${base}/api/files/scan-orphans`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ graceHours: 0 }),
  });
  assert.equal(res.status, 200);
  let body = await res.json();
  const orphan = body.data.orphans.find((o) => o.publicId === "hrm/mo-coi");
  assert.ok(orphan);
  assert.ok(body.data.totalBytes > 0);

  res = await fetch(`${base}/api/files/purge-orphans`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ publicIds: ["hrm/mo-coi"] }),
  });
  assert.equal(res.status, 200);
  body = await res.json();
  assert.equal(body.data.purged, 1);
  assert.ok(!fs.existsSync(path.join(tmpDir, "hrm", "mo-coi.png")));
});