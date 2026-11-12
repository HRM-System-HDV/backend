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
module.exports = {syncEmployeeToIdentity};