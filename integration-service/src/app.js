"use strict";

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const config = require("./config");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(morgan("dev"));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
// SOAP nhận và trả XML nguyên vẹn — không bọc {data}/{error}.
app.use(express.text({ limit: "1mb", type: ["text/xml", "application/xml", "application/soap+xml"] }));
app.use(cookieParser());

// Health check endpoint đúng chuẩn: { status: "ok", service: "...", time: "..." }
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: config.serviceName,
    time: new Date().toISOString(),
  });
});

// Các tuyến API CRUD độc lập (Task 1 & Task 2)
app.use("/api/news", require("./routes/newsRoutes"));
app.use("/api/regulations", require("./routes/regulationRoutes"));
app.use("/api/wifi-configs", require("./routes/wifiConfigRoutes"));
app.use("/api/requests", require("./routes/requestRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/soap-config", require("./routes/soapConfigRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
// SOAP ngân hàng: chuyển tiếp nguyên vẹn body/headers/status XML.
app.use("/soap/payroll", require("./routes/soapRoutes"));

// Xử lý 404
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Không tìm thấy tài nguyên",
    },
  });
});

app.use(errorHandler);

module.exports = app;
