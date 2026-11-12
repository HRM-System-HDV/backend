"use strict";
const config = require("../config");
const { request } = require("./http");
function publicIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = "/api/files/";
  const index = url.indexOf(marker);
  return index < 0 ? null : url.slice(index + marker.length).split(/[?#]/)[0];
}
module.exports = {
  getWifiConfigs: (branchId) => request(config.integrationServiceUrl, `/api/wifi-configs?branchId=${encodeURIComponent(branchId)}`),
  writeBacklog: (body) => request(config.integrationServiceUrl, "/api/backlog", { method: "POST", body: JSON.stringify(body) }),
  publicIdFromUrl,
  async deleteFileByUrl(url) {
    const id = publicIdFromUrl(url);
    if (!id) return;
    try { await request(config.integrationServiceUrl, `/api/files/${id}`, { method: "DELETE" }); }
    catch (error) { if (error.status !== 404) console.warn("[work-service] Không dọn được ảnh minh chứng:", error.message); }
  },
};
