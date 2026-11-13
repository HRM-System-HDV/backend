"use strict";
const config = require("../config");
async function syncEmployeeToIdentity(employee, action = "upsert") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),5000);
  try {
    const response = await fetch(`${config.identityUrl}/api/auth/sync-employee`, {
      method:"POST",headers:{"Content-Type":"application/json","x-internal-token":config.internalToken},
      body:JSON.stringify({employee:{id:employee.id,email:employee.email,name:employee.name,branchId:employee.branchId,status:employee.status},action}),signal:controller.signal,
    });
    const body = await response.json();
    if (!response.ok) { console.warn(`[identity-sync] ${response.status}: ${body.error?.message || "Đồng bộ thất bại"}`); return {ok:false,status:response.status}; }
    return {ok:true,...body.data};
  } catch(error) { console.warn(`[identity-sync] ${error.message}`); return {ok:false}; }
  finally {clearTimeout(timeout);}
}
async function getEmployeeRoles(employeeIds) {
  if (!employeeIds.length) return [];
  const result = [];
  for (let index = 0; index < employeeIds.length; index += 500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${config.identityUrl}/api/auth/internal/employee-roles`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": config.internalToken },
        body: JSON.stringify({ employeeIds: employeeIds.slice(index, index + 500) }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.data)) throw new Error("Identity không trả được vai trò nhân viên");
      result.push(...body.data);
    } catch (_error) {
      throw Object.assign(new Error("Không kiểm tra được vai trò người quản lý. Vui lòng thử lại."), { status: 503, code: "IDENTITY_UNAVAILABLE" });
    } finally { clearTimeout(timer); }
  }
  return result;
}
module.exports = {syncEmployeeToIdentity, getEmployeeRoles};
