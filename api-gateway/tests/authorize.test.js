"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createAuthorizeMiddleware } = require("../src/middlewares/authorize");

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function run(method, path, role) {
  const mw = createAuthorizeMiddleware();
  const req = { method, path, headers: {}, cookies: {} };
  if (role) req.user = { userId: "e-1", role };
  const res = mockRes();
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  return { passed, res };
}

// [method, path, role, mong đợi cho qua]
const cases = [
  // Hồ sơ nhân sự: nhân viên chỉ được sửa chính mình / xin thôi việc.
  ["POST", "/api/employees", "staff", false],
  ["POST", "/api/employees", "manager", true],
  ["PUT", "/api/employees/e-1", "staff", true],
  ["POST", "/api/employees/e-1/leave", "staff", true],
  ["DELETE", "/api/employees/e-1", "staff", false],
  ["DELETE", "/api/employees/e-1", "admin", true],

  // Chi nhánh / phòng ban không có màn nhân viên nào gọi ghi.
  ["POST", "/api/branches", "staff", false],
  ["PUT", "/api/branches/CN01", "manager", true],
  ["DELETE", "/api/departments/d1", "staff", false],

  // Phân ca là việc của quản lý; đăng ký/hủy đăng ký là của nhân viên.
  ["POST", "/api/shifts", "staff", false],
  ["POST", "/api/shifts", "manager", true],
  ["PUT", "/api/shifts/s1", "staff", false],
  ["DELETE", "/api/shifts/s1", "staff", false],
  ["POST", "/api/shifts/s1/assign", "staff", false],
  ["POST", "/api/shifts/register", "staff", true],
  ["POST", "/api/shifts/unregister", "staff", true],
  ["DELETE", "/api/shifts/registrations/r1", "staff", true],
  // Luật khung ca phải đứng trước luật /api/shifts/:id chung.
  ["POST", "/api/shifts/templates", "staff", false],
  ["PUT", "/api/shifts/templates/t1", "staff", false],
  ["POST", "/api/shift-templates", "staff", false],
  ["PUT", "/api/shift-templates/t1", "admin", true],

  ["PUT", "/api/attendance/config", "staff", false],
  ["PUT", "/api/attendance/config", "manager", true],
  ["POST", "/api/attendance/checkin", "staff", true],
  ["POST", "/api/attendance/checkout", "staff", true],

  // Duyệt đơn: route thật là PUT, không phải POST.
  ["PUT", "/api/requests/r1/approve", "staff", false],
  ["PUT", "/api/requests/r1/approve", "manager", true],
  ["PUT", "/api/requests/r1/reject", "staff", false],
  ["PUT", "/api/requests/r1/reject", "admin", true],
  ["POST", "/api/requests", "staff", true],
  ["DELETE", "/api/requests/r1", "staff", false],

  // Nhân viên được cập nhật tác vụ của mình, không tạo/xóa tác vụ.
  ["POST", "/api/tasks", "staff", false],
  ["DELETE", "/api/tasks/t1", "staff", false],
  ["PUT", "/api/tasks/t1", "staff", true],

  ["POST", "/api/news", "staff", false],
  ["GET", "/api/news", "staff", true],
  ["PUT", "/api/regulations/n1", "manager", true],
  ["POST", "/api/wifi-configs", "staff", false],
  ["GET", "/api/wifi-configs/scan", "staff", true],
  ["PUT", "/api/soap-config", "staff", false],

  // Lương: nhân viên xem phiếu của mình, không xem số tài khoản / đợt chi.
  ["GET", "/api/payroll/bank-accounts", "staff", false],
  ["GET", "/api/payroll/bank-accounts", "manager", true],
  ["GET", "/api/payroll/payouts", "staff", false],
  ["GET", "/api/payroll/payslips", "staff", true],
  ["POST", "/api/payroll/payslips/generate", "staff", false],
  ["PUT", "/api/payroll/payslips/p1/status", "staff", false],

  // Nhật ký: mọi vai trò ghi được, chỉ admin xóa toàn bộ.
  ["GET", "/api/backlog", "staff", false],
  ["GET", "/api/backlog", "manager", true],
  ["POST", "/api/backlog", "staff", true],
  ["DELETE", "/api/backlog", "manager", false],
  ["DELETE", "/api/backlog", "admin", true],

  // Cấp lại mật khẩu chỉ quản lý; sync-employee chỉ gọi nội bộ.
  ["POST", "/api/auth/reset-password", "staff", false],
  ["POST", "/api/auth/reset-password", "manager", true],
  ["POST", "/api/auth/reset-password", "admin", true],
  ["POST", "/api/auth/sync-employee", "staff", false],
  ["POST", "/api/auth/sync-employee", "admin", false],

  // Lưu trữ file: xem ảnh thì mọi vai trò đăng nhập, xóa/quét mồ côi chỉ admin.
  ["GET", "/api/files/hrm/avatars/a1", "staff", true],
  ["GET", "/api/files/hrm/tasks/t1", "manager", true],
  ["DELETE", "/api/files/hrm/avatars/a1", "staff", false],
  ["DELETE", "/api/files/hrm/avatars/a1", "manager", false],
  ["DELETE", "/api/files/hrm/avatars/a1", "admin", true],
  ["POST", "/api/files/scan-orphans", "staff", false],
  ["POST", "/api/files/scan-orphans", "admin", true],
  ["POST", "/api/files/purge-orphans", "manager", false],
  ["POST", "/api/files/purge-orphans", "admin", true],

  // Lưu trữ dữ liệu cũ: mọi thao tác (xem/chạy/khôi phục) chỉ admin.
  ["POST", "/api/archive/work/run", "staff", false],
  ["POST", "/api/archive/work/run", "manager", false],
  ["POST", "/api/archive/integration/run", "manager", false],
  ["GET", "/api/archive/work/tasks", "manager", false],
  ["GET", "/api/archive/integration/requests", "staff", false],
  ["GET", "/api/archive/integration/notifications/n1", "staff", false],
  ["POST", "/api/archive/work/tasks/t1/restore", "manager", false],
  ["POST", "/api/archive/work/run", "admin", true],
  ["GET", "/api/archive/work/tasks", "admin", true],
  ["GET", "/api/archive/integration/requests/r1", "admin", true],
  ["POST", "/api/archive/integration/requests/r1/restore", "admin", true],
];

for (const [method, path, role, allowed] of cases) {
  test(`${role} ${method} ${path} -> ${allowed ? "cho qua" : "403"}`, () => {
    const { passed, res } = run(method, path, role);
    assert.equal(passed, allowed);
    if (!allowed) {
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error.code, "FORBIDDEN");
    }
  });
}

test("thiếu danh tính (tuyến public) vẫn chặn thao tác ghi", () => {
  const { passed, res } = run("POST", "/api/employees", null);
  assert.equal(passed, false);
  assert.equal(res.statusCode, 403);
});

test("vai trò lạ không được hưởng quyền quản lý", () => {
  const { passed } = run("POST", "/api/employees", "superuser");
  assert.equal(passed, false);
});

test("tuyến chỉ nội bộ trả thông báo riêng", () => {
  const { res } = run("POST", "/api/auth/sync-employee", "admin");
  assert.match(res.body.error.message, /nội bộ/);
});