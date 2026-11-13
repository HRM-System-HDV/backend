-- Ca đã hủy không được tính khi kiểm tra trùng ca.
-- Trước đây UNIQUE (employeeId, workDate, templateId) áp dụng cho MỌI ca kể cả ca
-- đã hủy, nên hủy xong ca rồi phân lại đúng ca mẫu đó trong ngày luôn bị DB chặn (409).
-- Chuyển sang UNIQUE PARTIAL: chỉ những ca còn hiệu lực mới bị chặn trùng.
--
-- Lưu ý: Prisma không biểu diễn được UNIQUE PARTIAL trong schema.prisma, nên
-- ràng buộc này được quản lý bằng migration (schema đã bỏ @@unique tương ứng).
BEGIN;

-- Bỏ ràng buộc UNIQUE đầy đủ (áp dụng cho cả ca đã hủy).
DROP INDEX IF EXISTS "shifts_employeeId_workDate_templateId_key";

-- UNIQUE PARTIAL: chỉ ca còn hiệu lực (không phải 'đã hủy') mới bị chặn trùng.
CREATE UNIQUE INDEX "shifts_employeeId_workDate_templateId_active_key"
  ON "shifts" ("employeeId", "workDate", "templateId")
  WHERE "status" <> 'đã hủy';

COMMIT;
