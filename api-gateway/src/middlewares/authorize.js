"use strict";

// Phân quyền tại gateway: dịch vụ phía sau nhận danh tính qua header x-user-*
// nên không tự verify JWT, mọi chặn theo vai trò phải nằm ở đây.
const WRITE = ["POST", "PUT", "PATCH", "DELETE"];
const MANAGERS = ["admin", "manager"];
const ALL = ["admin", "manager", "staff"];

// Xét theo thứ tự, luật khớp đầu tiên thắng. `roles: []` = cấm mọi request từ
// bên ngoài, chỉ service nội bộ gọi thẳng mới được.
const rules = [
  { methods: ["POST"], path: /^\/api\/auth\/sync-employee$/, roles: [] },
  { methods: ["POST"], path: /^\/api\/auth\/reset-password$/, roles: MANAGERS },
  // Nhân viên tự xin thôi việc; organization-service kiểm đúng chủ sở hữu.
  { methods: ["POST"], path: /^\/api\/employees\/[^/]+\/leave$/, roles: ALL },
  // Nhân viên tự sửa hồ sơ của mình; organization-service chặn sửa người khác
  // và chặn các trường nhạy cảm (vai trò, lương, chi nhánh).
  { methods: ["PUT"], path: /^\/api\/employees\/[^/]+$/, roles: ALL },
  { methods: WRITE, path: /^\/api\/employees(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/(branches|departments)(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/shift-templates(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/shifts\/templates(\/|$)/, roles: MANAGERS },
  { methods: ["PUT"], path: /^\/api\/attendance\/config$/, roles: MANAGERS },
  { methods: ["POST"], path: /^\/api\/shifts$/, roles: MANAGERS },
  { methods: ["POST"], path: /^\/api\/shifts\/[^/]+\/assign$/, roles: MANAGERS },
  { methods: ["PUT", "DELETE"], path: /^\/api\/shifts\/[^/]+$/, roles: MANAGERS },
  // Chỉ quản lý duyệt đơn; nhân viên chấp nhận nhờ làm thay/đổi ca là luồng khác.
  { methods: ["PUT"], path: /^\/api\/requests\/[^/]+\/(approve|reject)$/, roles: MANAGERS },
  { methods: ["DELETE"], path: /^\/api\/requests\/[^/]+$/, roles: MANAGERS },
  { methods: ["POST", "DELETE"], path: /^\/api\/tasks(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/(news|regulations|wifi-configs|soap-config)(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/payroll(\/|$)/, roles: MANAGERS },
  // Số tài khoản và các đợt chi lương là dữ liệu quản lý, không phải của nhân viên.
  { methods: ["GET"], path: /^\/api\/payroll\/(bank-accounts|payouts)(\/|$)/, roles: MANAGERS },
  { methods: ["GET"], path: /^\/api\/backlog(\/|$)/, roles: MANAGERS },
  // Xóa nhật ký hoạt động là thao tác quản trị; ghi nhật ký thì mọi vai trò.
  { methods: ["DELETE"], path: /^\/api\/backlog(\/|$)/, roles: ["admin"] },
];

function createAuthorizeMiddleware(options = {}) {
  const table = options.rules || rules;

  return function authorizeMiddleware(req, res, next) {
    const rule = table.find((r) => r.methods.includes(req.method) && r.path.test(req.path));
    if (!rule) return next();
    const role = req.user && req.user.role;
    if (role && rule.roles.includes(role)) return next();
    return res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: rule.roles.length
          ? "Bạn không có quyền thực hiện thao tác này"
          : "Tuyến này chỉ dành cho gọi nội bộ giữa các service",
      },
    });
  };
}

module.exports = { createAuthorizeMiddleware, rules };