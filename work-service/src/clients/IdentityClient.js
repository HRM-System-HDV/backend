"use strict";
const config = require("../config");
const { request } = require("./http");
module.exports = {
  getUserName: (id) => request(config.identityServiceUrl, `/api/auth/internal/users/${encodeURIComponent(id)}/name`),
};
