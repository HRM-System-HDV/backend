"use strict";

function errorHandler(err, _req, res, _next) {
  if (["P2002", "P2034"].includes(err.code)) return res.status(409).json({ error: { code: "DUPLICATE_RESOURCE", message: "Dữ liệu bị trùng hoặc vừa thay đổi, vui lòng tải lại" } });
  if (err.code === "P2003") return res.status(409).json({ error: { code: "RESOURCE_IN_USE", message: "Dữ liệu đang được tham chiếu, không thể xóa" } });
  if (err.code === "P2025") return res.status(404).json({ error: { code: "NOT_FOUND", message: "Không tìm thấy bản ghi" } });
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "Lỗi hệ thống";
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
