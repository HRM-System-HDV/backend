"use strict";

// Phân quyền tại gateway: dịch vụ phía sau nhận danh tính qua header x-user-*
// nên kiểm tra vai trò tại gateway và phạm vi bản ghi tại service nghiệp vụ.
const { sendError } = require("../utils/soapFault");
const WRITE = ["POST", "PUT", "PATCH", "DELETE"];
const MANAGERS = ["admin", "manager"];
const ALL = ["admin", "manager", "staff"];

// Xét theo thứ tự, luật khớp đầu tiên thắng. `roles: []` = cấm mọi request từ
// bên ngoài, chỉ service nội bộ gọi thẳng mới được.
const rules = [
  { methods: ["GET", ...WRITE], path: /^\/api\/auth\/internal(\/|$)/, roles: [] },
  { methods: ["POST"], path: /^\/api\/auth\/sync-employee$/, roles: [] },
  { methods: WRITE, path: /^\/api\/auth\/users(\/|$)/, roles: ["admin"] },
  { methods: ["GET"], path: /^\/api\/auth\/users(\/|$)/, roles: ["admin"] },
  { methods: ["POST"], path: /^\/api\/auth\/reset-password$/, roles: ["admin"] },
  // Nhân viên tự xin thôi việc; organization-service kiểm đúng chủ sở hữu.
  { methods: ["POST"], path: /^\/api\/employees\/[^/]+\/leave$/, roles: ALL },
  // Nhân viên tự sửa hồ sơ của mình; organization-service chặn sửa người khác
  // và chặn các trường nhạy cảm (vai trò, lương, chi nhánh).
  { methods: ["PUT"], path: /^\/api\/employees\/[^/]+$/, roles: ALL },
  { methods: WRITE, path: /^\/api\/employees(\/|$)/, roles: MANAGERS },
  // Manager/Admin ghi chi nhánh; organization-service kiểm tra phạm vi branchId.
  { methods: WRITE, path: /^\/api\/branches(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/departments(\/|$)/, roles: MANAGERS },
  // Danh mục vị trí là admin-only: organization-service chặn bằng assertAdmin,
  // nên gateway cũng phải chặn ở đây — để MANAGERS thì manager lọt qua gateway rồi
  // nhận 403 từ service (xem tests/integration/org.test.js của organization).
  { methods: WRITE, path: /^\/api\/positions(\/|$)/, roles: ["admin"] },
  { methods: WRITE, path: /^\/api\/shift-templates(\/|$)/, roles: MANAGERS },
  // Cấu hình chấm công theo chi nhánh: đọc cho mọi vai trò (service giới hạn đúng
  // chi nhánh của mình), ghi chỉ admin/manager; manager chỉ sửa chi nhánh của mình.
  { methods: ["GET"], path: /^\/api\/attendance\/config$/, roles: ALL },
  { methods: WRITE, path: /^\/api\/attendance\/config$/, roles: MANAGERS },
  { methods: ["PUT", "PATCH", "DELETE"], path: /^\/api\/attendance\/[^/]+$/, roles: MANAGERS },
  { methods: ["POST"], path: /^\/api\/shifts$/, roles: MANAGERS },
  // Hoán đổi ca khi duyệt đơn là lệnh nội bộ integration -> work; client không bao giờ gọi trực tiếp.
  { methods: ["POST"], path: /^\/api\/shifts\/swap$/, roles: [] },
  { methods: ["POST"], path: /^\/api\/shifts\/[^/]+\/assign$/, roles: MANAGERS },
  { methods: ["PUT", "DELETE"], path: /^\/api\/shifts\/[^/]+$/, roles: MANAGERS },
  // Chỉ quản lý duyệt đơn; nhân viên chấp nhận nhờ làm thay/đổi ca là luồng khác.
  { methods: ["PUT"], path: /^\/api\/requests\/[^/]+\/(approve|reject)$/, roles: MANAGERS },
  { methods: ["DELETE"], path: /^\/api\/requests\/[^/]+$/, roles: MANAGERS },
  { methods: ["POST", "DELETE"], path: /^\/api\/tasks(\/|$)/, roles: MANAGERS },
  // Tin tức/nội quy là nghiệp vụ vận hành chi nhánh nên manager vẫn ghi được;
  // cấu hình Wi-Fi và cấu hình SOAP là tính năng hệ thống, chỉ admin.
  { methods: WRITE, path: /^\/api\/(news|regulations)(\/|$)/, roles: MANAGERS },
  { methods: WRITE, path: /^\/api\/(wifi-configs|soap-config)(\/|$)/, roles: ["admin"] },
  // Gửi thông báo là thao tác quản lý: nhân viên không tự bắn thông báo cho
  // người khác (và không mạo được tên người gửi).
  { methods: ["POST"], path: /^\/api\/notifications\/reminders$/, roles: ALL },
  { methods: ["POST"], path: /^\/api\/notifications(\/|$)/, roles: MANAGERS },
  // Đọc cấu hình SOAP lộ endpointUrl/securityMode/allowedIPs/certExpiry nên để
  // admin; WRITE đã có luật riêng ở trên, GET thì hiện không luật nào chặn.
  { methods: ["GET"], path: /^\/api\/soap-config(\/|$)/, roles: ["admin"] },
  // Cổng SOAP chi lương: POST /soap/payroll trực tiếp tạo lệnh trừ tiền tài khoản
  // công ty. publicPaths chỉ whitelist GET (WSDL) nên WRITE tới đây luôn có
  // req.user và luật ["admin"] có tác dụng.
  { methods: WRITE, path: /^\/soap(\/|$)/, roles: ["admin"] },
  // Xác nhận không chi tiền; service kiểm tra nhân viên sở hữu/manager đúng chi nhánh.
  { methods: ["POST", "PUT", "PATCH"], path: /^\/api\/payroll\/payslips\/[^/]+\/(confirm|status)$/, roles: ALL },
  // Chi lương là thao tác ngân hàng, manager bị chặn theo mô hình 3 vai trò.
  { methods: WRITE, path: /^\/api\/payroll(\/|$)/, roles: ["admin"] },
  // Số tài khoản và các đợt chi lương là dữ liệu quản trị hệ thống.
  { methods: ["GET"], path: /^\/api\/payroll\/(bank-accounts|payouts)(\/|$)/, roles: ["admin"] },
  // Nhật ký thao tác hệ thống: chỉ admin được xem.
  { methods: ["GET"], path: /^\/api\/backlog(\/|$)/, roles: ["admin"] },
  // Xóa nhật ký hoạt động là thao tác quản trị; ghi nhật ký thì mọi vai trò.
  { methods: ["DELETE"], path: /^\/api\/backlog(\/|$)/, roles: ["admin"] },
  // Đọc file ảnh thì mọi vai trò đăng nhập; xóa/quét mồ côi chỉ admin.
  { methods: ["POST", "DELETE"], path: /^\/api\/files(\/|$)/, roles: ["admin"] },
];

function createAuthorizeMiddleware(options = {}) {
  const table = options.rules || rules;

  return function authorizeMiddleware(req, res, next) {
    const rule = table.find((r) => r.methods.includes(req.method) && r.path.test(req.path));
    if (!rule) return next();
    const role = req.user && req.user.role;
    if (role && rule.roles.includes(role)) return next();
    return sendError(
      req,
      res,
      403,
      "FORBIDDEN",
      rule.roles.length
        ? "Bạn không có quyền thực hiện thao tác này"
        : "Tuyến này chỉ dành cho gọi nội bộ giữa các service",
    );
  };
}

module.exports = { createAuthorizeMiddleware, rules };
