"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.JWT_SECRET = "test_gateway_secret_1234567890";

const jwt = require("jsonwebtoken");
const { createAuthMiddleware } = require("../src/middlewares/auth");

// `clientPlatform` ở đây là nền tảng của REQUEST hiện tại, tức giá trị mà
// clientContext.js ghi vào req.clientPlatform trước auth. Truyền undefined =
// req không có property này (để chứng minh middleware không nới cho case đó).
function mockReq({ path = "/api/employees", method = "GET", token, clientPlatform } = {}) {
  const req = { path, method, headers: {}, cookies: {} };
  if (token) req.headers.authorization = `Bearer ${token}`;
  if (clientPlatform !== undefined) req.clientPlatform = clientPlatform;
  return req;
}

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

test("tuyến công khai login không cần token", () => {
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [{ method: "POST", path: "/api/auth/login", exact: true }] });
  let passed = false;
  mw(mockReq({ path: "/api/auth/login", method: "POST" }), mockRes(), () => {
    passed = true;
  });
  assert.equal(passed, true);
});

test("tuyến bảo vệ thiếu token trả 401", () => {
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq(), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
});

test("token hợp lệ gắn req.user và cho qua", () => {
  const token = jwt.sign({ userId: "e-1", role: "admin" }, process.env.JWT_SECRET);
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const req = mockReq({ token });
  const res = mockRes();
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  assert.equal(passed, true);
  assert.equal(req.user.userId, "e-1");
  assert.equal(req.user.role, "admin");
});

test("refresh token bị từ chối", () => {
  const token = jwt.sign({ userId: "e-1", type: "refresh" }, process.env.JWT_SECRET);
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq({ token }), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("token hết hạn trả 401", () => {
  const token = jwt.sign({ userId: "e-1" }, "sai_secret_khac");
  const mw = createAuthMiddleware({ secret: process.env.JWT_SECRET, publicPaths: [] });
  const res = mockRes();
  let passed = false;
  mw(mockReq({ token }), res, () => {
    passed = true;
  });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 401);
});

test("danh tính giữ riêng userId/employeeId và dùng branchId UUID", () => {
  const token = jwt.sign({ userId: "user-1", employeeId: "employee-2", branchId: "branch-3", role: "manager" }, process.env.JWT_SECRET);
  const req = mockReq({ token });
  let passed = false;
  createAuthMiddleware({ publicPaths: [] })(req, mockRes(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.user.employeeId, "employee-2");
  assert.equal(req.user.branchId, "branch-3");
  assert.equal(req.user.branchSlug, undefined);
});

// Q-A-06: luật "nhân viên chỉ đăng nhập trên Mobile" phải xét theo nền tảng của
// REQUEST HIỆN TẠI (req.clientPlatform do clientContext tính từ Origin/User-Agent),
// không chỉ theo clientPlatform trong payload (giá trị ghi lúc CẤP token).
// Nếu không, staff lấy token mobile hợp lệ rồi gọi API từ trình duyệt vẫn qua Gateway.
function callStaff({ path, payloadPlatform, requestPlatform, useCookie }) {
  const middleware = createAuthMiddleware({ publicPaths: [] });
  const token = jwt.sign(
    { userId: "u-1", employeeId: "e-2", role: "staff", clientPlatform: payloadPlatform },
    process.env.JWT_SECRET,
  );
  const req = mockReq({ path, token: useCookie ? undefined : token, clientPlatform: requestPlatform });
  if (useCookie) req.cookies["hrm-session"] = token;
  const res = mockRes();
  let passed = false;
  middleware(req, res, () => {
    passed = true;
  });
  return { passed, res, req };
}

test("staff chỉ qua khi cả token lẫn request hiện tại là mobile (Q-A-06)", () => {
  const cases = [
    { name: "token mobile + request web (browser giả token mobile)", payloadPlatform: "mobile", requestPlatform: "web", expected: false },
    { name: "token mobile + request web trên /api/payroll", payloadPlatform: "mobile", requestPlatform: "web", expected: false, path: "/api/payroll/payslips" },
    { name: "token mobile + request KHÔNG có clientPlatform (không được mặc định là mobile)", payloadPlatform: "mobile", requestPlatform: undefined, expected: false },
    { name: "token web + request mobile", payloadPlatform: "web", requestPlatform: "mobile", expected: false },
    { name: "token thiếu clientPlatform + request mobile", payloadPlatform: undefined, requestPlatform: "mobile", expected: false },
    { name: "token mobile + request mobile qua Bearer", payloadPlatform: "mobile", requestPlatform: "mobile", expected: true },
  ];
  for (const testCase of cases) {
    const { passed, res, req } = callStaff(testCase);
    assert.equal(passed, testCase.expected, testCase.name);
    if (!testCase.expected) {
      assert.equal(res.statusCode, 403, testCase.name);
      assert.equal(res.body.error.code, "FORBIDDEN", testCase.name);
    }
  }
  // Case duy nhất qua: danh tính vẫn giữ đúng nền tảng của token.
  const ok = callStaff({ payloadPlatform: "mobile", requestPlatform: "mobile" });
  assert.equal(ok.req.user.clientPlatform, "mobile");
  assert.equal(ok.req.user.employeeId, "e-2");
});

test("staff dùng cookie phiên web luôn bị chặn, dù token payload là mobile", () => {
  for (const requestPlatform of [undefined, "web", "mobile"]) {
    const { passed, res } = callStaff({ payloadPlatform: "mobile", requestPlatform, useCookie: true });
    assert.equal(passed, false, `cookie web, request=${requestPlatform}`);
    assert.equal(res.statusCode, 403, `cookie web, request=${requestPlatform}`);
  }
});

test("admin và manager không bị ràng buộc bởi nền tảng request", () => {
  for (const role of ["admin", "manager"]) {
    const middleware = createAuthMiddleware({ publicPaths: [] });
    const token = jwt.sign({ userId: "u-1", role }, process.env.JWT_SECRET);
    for (const requestPlatform of ["web", "mobile", undefined]) {
      const req = mockReq({ token, clientPlatform: requestPlatform });
      const res = mockRes();
      let passed = false;
      middleware(req, res, () => {
        passed = true;
      });
      assert.equal(passed, true, `${role} trên ${requestPlatform}`);
    }
  }
});

test("token thiếu người dùng hoặc sai vai trò bị chặn", () => {
  for (const payload of [{ role: "admin" }, { userId: "u-1", role: "superuser" }]) {
    const res = mockRes();
    createAuthMiddleware({ publicPaths: [] })(mockReq({ token: jwt.sign(payload, process.env.JWT_SECRET) }), res,
      () => assert.fail("Không cho qua danh tính sai"));
    assert.equal(res.statusCode, 401);
  }
});
