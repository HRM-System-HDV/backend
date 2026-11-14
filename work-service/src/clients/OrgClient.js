"use strict";
const config = require("../config");
const { request } = require("./http");
module.exports = {
  getEmployee: (id) => request(config.organizationServiceUrl, `/api/employees/${encodeURIComponent(id)}`),
  listEmployees: (branchId) => request(config.organizationServiceUrl, `/api/employees${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
};
