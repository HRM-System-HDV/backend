ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "requestType" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftName" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftDate" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftTime" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftHours" TEXT,
  ADD COLUMN IF NOT EXISTS "senderName" TEXT,
  ADD COLUMN IF NOT EXISTS "senderRole" TEXT,
  ADD COLUMN IF NOT EXISTS "senderPhone" TEXT;

CREATE TABLE IF NOT EXISTS "soap_gateway_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "endpointUrl" TEXT NOT NULL,
  "wsdlUrl" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 8443,
  "securityMode" TEXT NOT NULL,
  "allowedIPs" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "lastPingTime" TEXT,
  "avgResponseTime" TEXT,
  CONSTRAINT "soap_gateway_configs_pkey" PRIMARY KEY ("id")
);
