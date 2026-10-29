"use strict";

const assert = require("node:assert/strict");
const { test, describe, before, after } = require("node:test");
const app = require("../../src/app");
const database = require("../../src/config/database");

describe("Management Modules Integration Tests (News, Regulations, WifiConfigs)", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await database.disconnect();
  });

  // --- 1. BẢNG TIN (NEWS) ---
  describe("News CRUD", () => {
    let createdNewsId;

    test("GET /api/news trả về danh sách bảng tin", async () => {
      const res = await fetch(`${baseUrl}/api/news`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.data));
    });

    test("POST /api/news tạo tin tức mới thành công", async () => {
      const newPost = {
        title: "Tin tuyển dụng tháng 9",
        summary: "Tuyển dụng nhân viên vận hành chi nhánh",
        content: "Chi tiết các vị trí ứng tuyển...",
        author: "Phòng Nhân Sự",
        tag: "Tuyển dụng",
        tagTone: "success",
        pinned: true,
      };

      const res = await fetch(`${baseUrl}/api/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPost),
      });

      const body = await res.json();
      assert.equal(res.status, 201);
      assert.ok(body.data.id);
      assert.equal(body.data.title, newPost.title);
      assert.equal(body.data.pinned, true);
      createdNewsId = body.data.id;
    });

    test("GET /api/news/:id trả về chi tiết tin tức vừa tạo", async () => {
      const res = await fetch(`${baseUrl}/api/news/${createdNewsId}`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.id, createdNewsId);
      assert.equal(body.data.title, "Tin tuyển dụng tháng 9");
    });

    test("PUT /api/news/:id cập nhật tin tức thành công", async () => {
      const res = await fetch(`${baseUrl}/api/news/${createdNewsId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Tin tuyển dụng đã cập nhật" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.title, "Tin tuyển dụng đã cập nhật");
    });

    test("DELETE /api/news/:id xóa tin tức thành công", async () => {
      const res = await fetch(`${baseUrl}/api/news/${createdNewsId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.deleted, true);

      // Xác nhận không còn tìm thấy
      const getRes = await fetch(`${baseUrl}/api/news/${createdNewsId}`);
      assert.equal(getRes.status, 404);
    });
  });

  // --- 2. NỘI QUY (REGULATIONS) ---
  describe("Regulations CRUD", () => {
    let createdRegId;

    test("GET /api/regulations trả về danh sách nội quy", async () => {
      const res = await fetch(`${baseUrl}/api/regulations`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.data));
    });

    test("POST /api/regulations tạo nội quy mới thành công", async () => {
      const newReg = {
        code: "NQ-2026-TEST",
        title: "Quy tắc an toàn PCCC",
        category: "An toàn lao động",
        summary: "Hướng dẫn xử lý khi có chuông báo cháy",
        content: "Chi tiết các bước di tản...",
        status: "hiệu lực",
        scope: "Toàn công ty",
      };

      const res = await fetch(`${baseUrl}/api/regulations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newReg),
      });

      const body = await res.json();
      assert.equal(res.status, 201);
      assert.ok(body.data.id);
      assert.equal(body.data.code, newReg.code);
      createdRegId = body.data.id;
    });

    test("GET /api/regulations/:id trả về chi tiết nội quy", async () => {
      const res = await fetch(`${baseUrl}/api/regulations/${createdRegId}`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.id, createdRegId);
      assert.equal(body.data.code, "NQ-2026-TEST");
    });

    test("PUT /api/regulations/:id cập nhật nội quy", async () => {
      const res = await fetch(`${baseUrl}/api/regulations/${createdRegId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: "1.2" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.version, "1.2");
    });

    test("DELETE /api/regulations/:id xóa nội quy", async () => {
      const res = await fetch(`${baseUrl}/api/regulations/${createdRegId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.deleted, true);

      const getRes = await fetch(`${baseUrl}/api/regulations/${createdRegId}`);
      assert.equal(getRes.status, 404);
    });
  });

  // --- 3. WI-FI CHẤM CÔNG (WIFI CONFIGS) ---
  describe("WifiConfigs CRUD", () => {
    let createdWifiId;

    test("GET /api/wifi-configs trả về danh sách cấu hình Wi-Fi", async () => {
      const res = await fetch(`${baseUrl}/api/wifi-configs`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.data));
    });

    test("GET /api/wifi-configs?branch=HN-1 lọc theo chi nhánh", async () => {
      const res = await fetch(`${baseUrl}/api/wifi-configs?branch=HN-1`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(body.data));
      body.data.forEach((w) => assert.equal(w.branch, "HN-1"));
    });

    test("POST /api/wifi-configs tạo cấu hình Wi-Fi mới", async () => {
      const newWifi = {
        ssid: "HRM_TEST_OFFICE",
        bssid: "00:AA:BB:CC:DD:EE",
        branch: "HN-3",
        status: "hoạt động",
      };

      const res = await fetch(`${baseUrl}/api/wifi-configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newWifi),
      });

      const body = await res.json();
      assert.equal(res.status, 201);
      assert.ok(body.data.id);
      assert.equal(body.data.ssid, newWifi.ssid);
      createdWifiId = body.data.id;
    });

    test("GET /api/wifi-configs/:id trả về chi tiết Wi-Fi vừa tạo", async () => {
      const res = await fetch(`${baseUrl}/api/wifi-configs/${createdWifiId}`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.id, createdWifiId);
      assert.equal(body.data.ssid, "HRM_TEST_OFFICE");
    });

    test("PUT /api/wifi-configs/:id cập nhật trạng thái Wi-Fi", async () => {
      const res = await fetch(`${baseUrl}/api/wifi-configs/${createdWifiId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "vô hiệu hóa" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.status, "vô hiệu hóa");
    });

    test("DELETE /api/wifi-configs/:id xóa cấu hình Wi-Fi", async () => {
      const res = await fetch(`${baseUrl}/api/wifi-configs/${createdWifiId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.deleted, true);

      const getRes = await fetch(`${baseUrl}/api/wifi-configs/${createdWifiId}`);
      assert.equal(getRes.status, 404);
    });
  });
});
