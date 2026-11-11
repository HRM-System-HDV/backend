-- Cửa sổ chốt ra (phút) tính từ giờ kết thúc ca; quá hạn thì ca bị bỏ qua (missed),
-- không được ghi công cho tới khi admin/manager chấm công ra cho ca đó. 0 = tắt.
ALTER TABLE "attendance_configs"
  ADD COLUMN IF NOT EXISTS "checkoutWindowMinutes" INTEGER NOT NULL DEFAULT 60;
