"use strict";

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const config = require("./config");
const database = require("./config/database");
const authRoutes = require("./routes/authRoutes");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(morgan("dev"));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: config.serviceName,
    database: database.getMode(),
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
});

app.use(errorHandler);

module.exports = app;
