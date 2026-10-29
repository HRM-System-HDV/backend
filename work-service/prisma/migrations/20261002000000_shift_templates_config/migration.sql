-- Add missing attendance config fields used by Web AttendanceConfigModal
ALTER TABLE "attendance_configs"
  ADD COLUMN IF NOT EXISTS "latePenaltyPct" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "earlyLeavePenaltyPct" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "earlyCheckinMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "maxPenaltiesPerMonth" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "deductOnCheckout" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowDoubleCheckin" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maxCheckinsPerDay" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "maxSwapsPerMonth" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "requireReasonSwap" BOOLEAN NOT NULL DEFAULT true;

-- Shift templates for managing reusable shift definitions
CREATE TABLE IF NOT EXISTS "shift_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);
