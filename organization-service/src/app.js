"use strict";

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const config = require("./config");
const orgRoutes = require("./routes/orgRoutes");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(morgan("dev"));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: config.serviceName, time: new Date().toISOString() });
});

app.use("/api", orgRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
});

app.use(errorHandler);

module.exports = app;
