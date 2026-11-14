"use strict";
const config = require("../config");
const {error} = require("../utils/access");
async function call(base, pathname, {method="GET", body, actor} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const headers = {"Content-Type":"application/json", "x-internal-token":config.internalToken};
  if (actor) for (const [key, name] of Object.entries({userId:"x-user-id",employeeId:"x-employee-id",branchId:"x-branch-id",role:"x-user-role",name:"x-user-name"})) if (actor[key]) headers[name] = key === "name" ? encodeURIComponent(actor[key]) : actor[key];
  try {
    const response = await fetch(`${base}${pathname}`, {method, headers, body:body === undefined ? undefined : JSON.stringify(body), signal:controller.signal});
    const json = await response.json();
    if (!response.ok) throw error(json.error?.message || "Dịch vụ liên quan từ chối yêu cầu", response.status, json.error?.code || "BAD_GATEWAY");
    return json.data;
  } catch (e) { if (e.status) throw e; throw error("Không kết nối được dịch vụ liên quan",502,"BAD_GATEWAY"); }
  finally { clearTimeout(timer); }
}
module.exports = {
  employees: query => call(config.organizationServiceUrl, `/api/employees?${new URLSearchParams(query || {})}`),
  employee: id => call(config.organizationServiceUrl, `/api/employees/${encodeURIComponent(id)}`),
  shifts: query => call(config.workServiceUrl, `/api/shifts?${new URLSearchParams(query || {})}`),
  shift: id => call(config.workServiceUrl, `/api/shifts/${encodeURIComponent(id)}`),
  swapShifts: (body, actor) => call(config.workServiceUrl, "/api/shifts/swap", {method:"POST",body,actor}),
  attendanceConfig: branchId => call(config.workServiceUrl, `/api/attendance/config${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
  payout: (body, actor) => call(config.payrollServiceUrl, "/api/payroll/payouts", {method:"POST",body,actor}),
};
