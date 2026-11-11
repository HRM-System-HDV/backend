-- Đồng bộ khóa cài đặt thông báo với 10 switch của mobile.
ALTER TABLE "notification_settings"
  ADD COLUMN "checkInBefore1Hour" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInBefore30Min" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInBefore10Min" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkOutBefore10Min" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "missedCheckOutAfter10Min" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "missedCheckOutAfter30Min" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "missedCheckOutAfter1Hour" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tabNotificationAlert" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "notification_settings"
  DROP COLUMN "remindCheckIn",
  DROP COLUMN "remindCheckOut",
  DROP COLUMN "remindShift",
  DROP COLUMN "notifyTask",
  DROP COLUMN "notifyLeave";