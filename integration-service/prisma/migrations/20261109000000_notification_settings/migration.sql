-- Cài đặt thông báo trước đây chỉ nằm trong RAM, mất khi restart service.
CREATE TABLE IF NOT EXISTS "notification_settings" (
  "id" TEXT NOT NULL,
  "remindCheckIn" BOOLEAN NOT NULL DEFAULT true,
  "remindCheckOut" BOOLEAN NOT NULL DEFAULT true,
  "remindShift" BOOLEAN NOT NULL DEFAULT true,
  "notifyTask" BOOLEAN NOT NULL DEFAULT true,
  "notifyLeave" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);
