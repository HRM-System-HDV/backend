"use strict";

// Envelope lỗi chuẩn: { error: { code, message } } theo docs/RULES §5.2
function errorHandler(err, _req, res, _next) {
  if(err.code === "P2002") return res.status(409).json({error:{code:"DUPLICATE_RESOURCE",message:"Dữ liệu đã tồn tại"}});
  if(["P2003","P2025"].includes(err.code)) return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Tham chiếu dữ liệu không hợp lệ"}});
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  const message = err.message || "Lỗi máy chủ nội bộ";
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
