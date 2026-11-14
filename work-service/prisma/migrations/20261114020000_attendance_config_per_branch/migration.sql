-- Cấu hình chấm công chuyển từ singleton toàn hệ thống sang THEO CHI NHÁNH.
-- Row có branchId = NULL là kế thừa trực tiếp của row singleton cũ và trở thành
-- CẤU HÌNH MẶC ĐỊNH toàn hệ thống; row branchId = <uuid chi nhánh> (branches.id
-- của organization-service — khác DB nên không có FK) áp dụng RIÊNG cho chi nhánh đó.
-- Thứ tự xét khi chấm công: row chi nhánh -> row mặc định -> DEFAULT_CONFIG trong code.
BEGIN;

-- Bỏ ràng buộc "chỉ một row singleton" cùng cột và index của nó.
ALTER TABLE "attendance_configs" DROP CONSTRAINT "attendance_config_singleton";
DROP INDEX IF EXISTS "attendance_configs_isSingleton_key";
ALTER TABLE "attendance_configs" DROP COLUMN "isSingleton";

-- Một row / một chi nhánh. Postgres coi NULL là phân biệt trong UNIQUE INDEX,
-- nên "chỉ một row mặc định" được WorkService đảm bảo khi ghi (upsert theo branchId).
ALTER TABLE "attendance_configs" ADD COLUMN "branchId" UUID;
CREATE UNIQUE INDEX "attendance_configs_branchId_key" ON "attendance_configs"("branchId");

COMMIT;
