-- Đơn nhờ làm thay / đổi ca cần biết nhân viên nào phải phản hồi.
ALTER TABLE "requests"
  ADD COLUMN IF NOT EXISTS "targetEmployeeId" TEXT;
