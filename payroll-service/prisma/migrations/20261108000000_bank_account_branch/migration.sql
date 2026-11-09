-- Cột đã có trong schema.prisma nhưng chưa từng có migration, gây lệch DB.
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "branch" TEXT;