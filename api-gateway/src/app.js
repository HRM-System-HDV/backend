"use strict";

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const { createProxyMiddleware } = require("http-proxy-middleware");
const config = require("./config");
const { errorHandler } = require("./middlewares/errorHandler");
const { correlationMiddleware } = require("./middlewares/logging");
const { createAuthMiddleware } = require("./middlewares/auth");
const { createAuthorizeMiddleware } = require("./middlewares/authorize");
const { createRateLimitMiddleware } = require("./middlewares/rateLimit");

const app = express();

app.use(morgan("dev"));
// CORS cho phiên cookie hrm-session: chỉ định origin cụ thể, không dùng "*".
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(correlationMiddleware);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: config.serviceName, time: new Date().toISOString() });
});

// Giới hạn tần suất + xác thực JWT trước khi proxy (TECHS.md §6.3).
app.use(createRateLimitMiddleware());
app.use(createAuthMiddleware());
app.use(createAuthorizeMiddleware());

function proxyTo(pathFilter, target, label) {
  // http-proxy-middleware v3: pathFilter nằm trong options, app.use không gắn
  // path Express để giữ nguyên full path /api/... khi forward. Timeout 5000ms.
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter,
    proxyTimeout: config.timeoutMs,
    timeout: config.timeoutMs,
    logLevel: "warn",
    on: {
      proxyReq: (proxyReq, req) => {
        // Client có thể tự gửi x-user-* để giả danh, nhất là ở tuyến public nơi
        // req.user chưa được set. Luôn xóa trước rồi mới gắn danh tính đã verify.
        for (const h of Object.keys(req.headers).filter((h) =>
          h.startsWith("x-user-") || ["x-employee-id", "x-branch-id", "x-branch-slug", "x-internal-token"].includes(h))) {
          proxyReq.removeHeader(h);
        }
        // Chuyển danh tính đã verify sang service phía sau, service không cần re-verify.
        if (req.user) {
          if (req.user.userId) proxyReq.setHeader("x-user-id", String(req.user.userId));
          if (req.user.employeeId) proxyReq.setHeader("x-employee-id", String(req.user.employeeId));
          if (req.user.email) proxyReq.setHeader("x-user-email", String(req.user.email));
          if (req.user.name) proxyReq.setHeader("x-user-name", encodeURIComponent(req.user.name));
          if (req.user.role) proxyReq.setHeader("x-user-role", String(req.user.role));
          if (req.user.branchId) proxyReq.setHeader("x-branch-id", String(req.user.branchId));
        }
        if (req.correlationId) {
          proxyReq.setHeader("x-correlation-id", req.correlationId);
        }
      },
      error: (err, _req, res) => {
        console.warn(`[gateway] ${label} lỗi:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({
            error: { code: "BAD_GATEWAY", message: `Không kết nối được ${label}` },
          });
        }
      },
    },
  });
}

// Bảng route qua gateway (docs/A §5). Đường dẫn ✔ từ tài liệu gốc giữ nguyên;
// nhóm (suy ra) vẫn proxy để B/D/E cắm vào không đổi gateway.
app.use(proxyTo("/api/auth", config.targets.identity, "identity-service"));
app.use(proxyTo("/api/branches", config.targets.organization, "organization-service"));
app.use(proxyTo("/api/departments", config.targets.organization, "organization-service"));
app.use(proxyTo("/api/positions", config.targets.organization, "organization-service"));
app.use(proxyTo("/api/employees", config.targets.organization, "organization-service"));
app.use(proxyTo("/api/shifts", config.targets.work, "work-service"));
app.use(proxyTo("/api/shift-templates", config.targets.work, "work-service"));
app.use(proxyTo("/api/attendance", config.targets.work, "work-service"));
app.use(proxyTo("/api/tasks", config.targets.work, "work-service"));
app.use(proxyTo("/api/payroll", config.targets.payroll, "payroll-service"));
// SOAP: chuyển tiếp nguyên vẹn body/headers/status XML, không bọc {data}/{error}.
app.use(proxyTo("/soap/payroll", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/news", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/regulations", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/wifi-configs", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/requests", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/notifications", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/soap-config", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/upload", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/backlog", config.targets.integration, "integration-service"));
app.use(proxyTo("/api/files", config.targets.integration, "integration-service"));

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
});

app.use(errorHandler);

module.exports = app;
