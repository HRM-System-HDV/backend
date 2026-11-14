"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");

function signAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, type: "refresh", jti: crypto.randomUUID() }, config.jwtSecret, {
    expiresIn: config.jwtRefreshExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signAccessToken, signRefreshToken, verifyToken };
