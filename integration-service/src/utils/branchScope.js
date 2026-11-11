"use strict";

// Chi nhánh của bản ghi ĐƯỢC TẠO phải lấy từ token, không từ body: nếu tin body
// thì manager/staff chỉ cần đổi JSON là ghi được dữ liệu sang chi nhánh khác,
// đúng đường mà đọc đã bị chặn. Chỉ admin được chọn chi nhánh tường minh.
function writeBranchSlug(req, bodyValue) {
  const tokenBranch = req.headers["x-branch-slug"] || null;
  if (req.headers["x-user-role"] === "admin") return bodyValue || tokenBranch;
  return tokenBranch;
}

module.exports = { writeBranchSlug };
