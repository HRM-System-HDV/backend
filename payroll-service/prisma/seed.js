"use strict";
// Không tạo tài khoản/số dư giả khi khởi động. Seed chủ động sau khi migration được duyệt.
if (require.main === module) console.log("Payroll không có dữ liệu mẫu bắt buộc; tạo tài khoản nguồn bằng API quản trị.");
