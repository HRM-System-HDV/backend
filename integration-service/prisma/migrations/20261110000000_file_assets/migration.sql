-- Đăng ký file upload lưu trữ nội bộ (thay dịch vụ đám mây bên thứ ba).
CREATE TABLE IF NOT EXISTS "file_assets" (
  "id" TEXT NOT NULL,
  "folder" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL DEFAULT 0,
  "height" INTEGER NOT NULL DEFAULT 0,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);