-- Các cột này đã có trong schema.prisma nhưng chưa từng có migration, gây lệch DB.
ALTER TABLE "news"
  ADD COLUMN IF NOT EXISTS "branch" TEXT NOT NULL DEFAULT 'Toàn công ty';

ALTER TABLE "soap_gateway_configs"
  ADD COLUMN IF NOT EXISTS "certExpiry" TEXT,
  ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'Gateway (REST/SOAP)';