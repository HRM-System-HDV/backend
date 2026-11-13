"use strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("crypto");
const service = require("../../src/services/AuthService");
const { verifyToken } = require("../../src/utils/jwt");
const admin = { userId: crypto.randomUUID(), role: "admin" };

async function staffAccount() {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  const synced = await service.syncEmployeeUseCase({ employee: { id, email, name: "Nhân viên", branchId: crypto.randomUUID() } });
  const { tempPassword } = await service.resetPasswordByAdminUseCase({ email, actor: admin });
  return { ...synced.user, email, password: tempPassword };
}

// Q-A-01: nền tảng lấy từ header x-client-platform do Gateway set (giá trị chuẩn).
// body.clientPlatform là dữ liệu không tin cậy khi đi qua Gateway nên chỉ dùng
// làm fallback cho lệnh gọi nội bộ gọi thẳng identity-service.
test("header x-client-platform được ưu tiên hơn body clientPlatform", async () => {
  const user = await staffAccount();
  // Browser gửi body clientPlatform=mobile nhưng Gateway đã chuẩn hóa header=web
  // -> nhân viên bị chặn, body không ghi đè được giá trị của Gateway.
  await assert.rejects(
    service.loginUseCase(
      { email: user.email, password: user.password, clientPlatform: "mobile" },
      { headers: { "x-client-platform": "web" } },
    ),
    error => error.status === 403,
  );
  // Header=mobile (Gateway xác định app thật) -> body web bị bỏ qua, cho qua.
  const login = await service.loginUseCase(
    { email: user.email, password: user.password, clientPlatform: "web" },
    { headers: { "x-client-platform": "mobile" } },
  );
  assert.equal(verifyToken(login.accessToken).clientPlatform, "mobile");
});

test("không có header thì fallback body clientPlatform (gọi nội bộ trực tiếp)", async () => {
  const user = await staffAccount();
  const login = await service.loginUseCase({ email: user.email, password: user.password, clientPlatform: "mobile" });
  assert.equal(verifyToken(login.accessToken).clientPlatform, "mobile");
  // Không có header lẫn body -> mặc định web -> nhân viên bị chặn.
  await assert.rejects(
    service.loginUseCase({ email: user.email, password: user.password }),
    error => error.status === 403,
  );
});

test("admin và manager không bị chặn theo nền tảng", async () => {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  await service.syncEmployeeUseCase({ employee: { id, email, name: "Quản lý", branchId: crypto.randomUUID() } });
  const { tempPassword } = await service.resetPasswordByAdminUseCase({ email, actor: admin });
  const user = await service.listUsersUseCase(admin).then(rows => rows.find(row => row.email === email));
  await service.updateUserUseCase(user.id, { systemRole: "manager" }, admin);
  const login = await service.loginUseCase({ email, password: tempPassword, clientPlatform: "web" });
  assert.equal(verifyToken(login.accessToken).clientPlatform, "web");
});

// Q-A-03: IP lấy từ header x-client-ip do Gateway chuẩn hóa từ socket, tuyệt đối
// không tin x-forwarded-for do client tự gửi.
test("ipAddress lấy từ x-client-ip của Gateway, không tin x-forwarded-for của client", async () => {
  const user = await staffAccount();
  const login = await service.loginUseCase(
    { email: user.email, password: user.password, clientPlatform: "mobile" },
    { headers: { "x-client-ip": "10.0.0.5", "x-forwarded-for": "1.1.1.1" } },
  );
  const devices = await service.getDevicesUseCase(user.id, login.deviceSessionId);
  assert.equal(devices[0].ipAddress, "10.0.0.5");
});

test("thiếu x-client-ip thì IP lấy từ socket, không rơi về x-forwarded-for", async () => {
  const user = await staffAccount();
  const login = await service.loginUseCase(
    { email: user.email, password: user.password, clientPlatform: "mobile" },
    { headers: { "x-forwarded-for": "1.1.1.1" } },
  );
  const devices = await service.getDevicesUseCase(user.id, login.deviceSessionId);
  assert.notEqual(devices[0].ipAddress, "1.1.1.1");
});

test("location chỉ là dữ liệu hiển thị, không ảnh hưởng quyết định bảo mật", async () => {
  const user = await staffAccount();
  const login = await service.loginUseCase(
    { email: user.email, password: user.password, clientPlatform: "mobile" },
    { headers: { "x-location": encodeURIComponent("Hà Nội"), "x-client-ip": "10.0.0.5" } },
  );
  const devices = await service.getDevicesUseCase(user.id, login.deviceSessionId);
  assert.equal(devices[0].location, "Hà Nội");
  assert.equal(devices[0].ipAddress, "10.0.0.5");
});
