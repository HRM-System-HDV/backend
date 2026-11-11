"use strict";

const crypto = require("crypto");
const logger = require("../utils/logger");

function correlationMiddleware(req, res, next) {
  const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  next();
}

module.exports = { correlationMiddleware, logger };
