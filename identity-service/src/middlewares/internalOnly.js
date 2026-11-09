"use strict";

const crypto = require("crypto");
const config = require("../config");
const { ForbiddenError } = require("../utils/errors");

// Tuyến chỉ dành cho service khác gọi thẳng (không qua gateway). Gateway đã
// chặn tuyến này với mọi request bên ngoài, đây là lớp chắn thứ hai.
function internalOnly(req, _res, next) {
  const provided = req.headers["x-internal-token"];
  const expected = config.internalToken;
  if (
    typeof provided !== "string" ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return next(new ForbiddenError("Tuyến này chỉ dành cho gọi nội bộ giữa các service"));
  }
  return next();
}

module.exports = { internalOnly };