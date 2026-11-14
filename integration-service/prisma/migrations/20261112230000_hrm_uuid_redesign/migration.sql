-- Redesign for the inspected empty local database. Never discard business rows.
BEGIN;
DO $$
DECLARE t text; has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['requests', 'notifications', 'notification_settings', 'soap_gateway_configs', 'news', 'regulations', 'wifi_configs', 'backlogs', 'file_assets', 'archived_requests', 'archived_notifications'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)', t) INTO has_rows;
      IF has_rows THEN RAISE EXCEPTION 'Redesign stopped: table % has data; a data migration is required', t; END IF;
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS "requests", "notifications", "notification_settings", "soap_gateway_configs", "news", "regulations", "wifi_configs", "backlogs", "file_assets", "archived_requests", "archived_notifications";

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('leave', 'advance', 'shift_swap', 'work_supplement');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ShiftSwapMode" AS ENUM ('manager_approval', 'mutual_acceptance');

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "type" "RequestType" NOT NULL,
    "employeeId" UUID NOT NULL,
    "targetEmployeeId" UUID,
    "branchId" UUID,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "leaveStartDate" DATE,
    "leaveEndDate" DATE,
    "advanceAmount" DECIMAL(15,0),
    "requestedCheckIn" TIMESTAMPTZ,
    "requestedCheckOut" TIMESTAMPTZ,
    "reviewedAt" TIMESTAMPTZ,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedBy" UUID,
    "reviewedByName" TEXT,
    "reviewNote" TEXT,
    "sourceShiftId" UUID,
    "targetShiftId" UUID,
    "shiftSwapMode" "ShiftSwapMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "targetEmployeeId" UUID NOT NULL,
    "branchId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "requestType" "RequestType",
    "requestId" UUID,
    "senderId" UUID,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "userId" UUID NOT NULL,
    "checkInBefore1Hour" BOOLEAN NOT NULL DEFAULT true,
    "checkInBefore30Min" BOOLEAN NOT NULL DEFAULT true,
    "checkInBefore10Min" BOOLEAN NOT NULL DEFAULT true,
    "checkOutBefore10Min" BOOLEAN NOT NULL DEFAULT true,
    "missedCheckOutAfter10Min" BOOLEAN NOT NULL DEFAULT true,
    "missedCheckOutAfter30Min" BOOLEAN NOT NULL DEFAULT true,
    "missedCheckOutAfter1Hour" BOOLEAN NOT NULL DEFAULT true,
    "tabNotificationAlert" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vibrateEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "soap_gateway_configs" (
    "id" UUID NOT NULL,
    "isSingleton" BOOLEAN NOT NULL DEFAULT true,
    "endpointUrl" TEXT NOT NULL,
    "wsdlUrl" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "securityMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastPingTime" TIMESTAMP(3),
    "avgResponseTime" TEXT,
    "certExpiry" TIMESTAMP(3),

    CONSTRAINT "soap_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishDate" DATE NOT NULL,
    "tag" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "branchId" UUID,
    "authorId" UUID,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulations" (
    "id" UUID NOT NULL,
    "regulationCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hiệu lực',
    "scopeBranchId" UUID,
    "effectiveDate" DATE NOT NULL,
    "expiryDate" DATE,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_configs" (
    "id" UUID NOT NULL,
    "ssid" TEXT NOT NULL,
    "bssid" TEXT NOT NULL,
    "branchId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wifi_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlogs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "user_name" TEXT NOT NULL,
    "user_role" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backlogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_assets" (
    "id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedBy" UUID,
    "branchId" UUID,
    "regulationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requests_employeeId_idx" ON "requests"("employeeId");

-- CreateIndex
CREATE INDEX "requests_targetEmployeeId_idx" ON "requests"("targetEmployeeId");

-- CreateIndex
CREATE INDEX "requests_branchId_idx" ON "requests"("branchId");

-- CreateIndex
CREATE INDEX "requests_status_idx" ON "requests"("status");

-- CreateIndex
CREATE INDEX "notifications_targetEmployeeId_idx" ON "notifications"("targetEmployeeId");

-- CreateIndex
CREATE INDEX "notifications_branchId_idx" ON "notifications"("branchId");

-- CreateIndex
CREATE INDEX "notifications_requestId_idx" ON "notifications"("requestId");

-- CreateIndex
CREATE INDEX "notifications_targetEmployeeId_isRead_createdAt_idx" ON "notifications"("targetEmployeeId", "isRead", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "soap_gateway_configs_isSingleton_key" ON "soap_gateway_configs"("isSingleton");

-- CreateIndex
CREATE INDEX "news_branchId_idx" ON "news"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "regulations_regulationCode_key" ON "regulations"("regulationCode");

-- CreateIndex
CREATE INDEX "regulations_scopeBranchId_idx" ON "regulations"("scopeBranchId");

-- CreateIndex
CREATE INDEX "wifi_configs_branchId_idx" ON "wifi_configs"("branchId");

-- CreateIndex
CREATE INDEX "backlogs_userId_idx" ON "backlogs"("userId");

-- CreateIndex
CREATE INDEX "backlogs_module_entity_type_entity_id_created_at_idx" ON "backlogs"("module", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_public_id_key" ON "file_assets"("public_id");

-- CreateIndex
CREATE INDEX "file_assets_uploadedBy_idx" ON "file_assets"("uploadedBy");

-- CreateIndex
CREATE INDEX "file_assets_branchId_idx" ON "file_assets"("branchId");

-- CreateIndex
CREATE INDEX "file_assets_regulationId_idx" ON "file_assets"("regulationId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "regulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Business constraints not represented by Prisma schema syntax.
ALTER TABLE soap_gateway_configs ADD CONSTRAINT soap_config_singleton CHECK ("isSingleton" = true);

ALTER TABLE requests ADD CONSTRAINT request_review_valid CHECK
((status = 'pending' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL)
OR (status IN ('approved', 'rejected') AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL));

ALTER TABLE requests ADD CONSTRAINT request_payload_valid CHECK
((type = 'leave' AND "leaveStartDate" IS NOT NULL AND "leaveEndDate" IS NOT NULL AND "leaveEndDate" >= "leaveStartDate")
OR (type = 'advance' AND "advanceAmount" IS NOT NULL AND "advanceAmount" > 0)
OR (type = 'shift_swap' AND "sourceShiftId" IS NOT NULL AND "targetEmployeeId" IS NOT NULL AND "shiftSwapMode" IS NOT NULL)
OR (type = 'work_supplement' AND "sourceShiftId" IS NOT NULL AND ("requestedCheckIn" IS NOT NULL OR "requestedCheckOut" IS NOT NULL)
AND ("requestedCheckIn" IS NULL OR "requestedCheckOut" IS NULL OR "requestedCheckOut" >= "requestedCheckIn")));
COMMIT;
