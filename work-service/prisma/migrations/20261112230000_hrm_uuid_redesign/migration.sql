-- Redesign for the inspected empty local database. Never discard business rows.
BEGIN;
DO $$
DECLARE t text; has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts', 'attendances', 'attendance_configs', 'shift_templates', 'shift_registrations', 'tasks', 'archived_tasks'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)', t) INTO has_rows;
      IF has_rows THEN RAISE EXCEPTION 'Redesign stopped: table % has data; a data migration is required', t; END IF;
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS "shifts", "attendances", "attendance_configs", "shift_templates", "shift_registrations", "tasks", "archived_tasks";

-- CreateEnum
CREATE TYPE "ShiftSwapMode" AS ENUM ('manager_approval', 'mutual_acceptance');

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "templateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "templateId" UUID NOT NULL,
    "scheduledStart" TEXT NOT NULL,
    "scheduledEnd" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'đang làm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "checkIn" TIMESTAMPTZ,
    "checkOut" TIMESTAMPTZ,
    "penaltyAmount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "penaltyNote" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_registrations" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "branchId" UUID,
    "registerDate" DATE NOT NULL,
    "templateId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedTo" UUID,
    "branchId" UUID,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "workDate" DATE,
    "templateId" UUID,
    "assignedBy" UUID,
    "assignedByName" TEXT,
    "shiftName" TEXT,
    "priority" TEXT DEFAULT 'normal',
    "assignedToName" TEXT,
    "completedAt" TIMESTAMP(3),
    "requirePhoto" BOOLEAN NOT NULL DEFAULT false,
    "proofPhotoUrl" TEXT,
    "photoSubmittedBy" UUID,
    "photoSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_configs" (
    "id" UUID NOT NULL,
    "isSingleton" BOOLEAN NOT NULL DEFAULT true,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 0,
    "checkoutWindowMinutes" INTEGER NOT NULL DEFAULT 60,
    "shiftSwapMode" "ShiftSwapMode" NOT NULL DEFAULT 'manager_approval',
    "latePenaltyPct" INTEGER NOT NULL DEFAULT 10,
    "earlyLeavePenaltyPct" INTEGER NOT NULL DEFAULT 10,
    "earlyCheckinMinutes" INTEGER NOT NULL DEFAULT 15,
    "allowDoubleCheckin" BOOLEAN NOT NULL DEFAULT false,
    "doubleCheckinEarlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "doubleCheckinLateMinutes" INTEGER NOT NULL DEFAULT 0,
    "requireReasonSwap" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "attendance_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_templates_templateCode_key" ON "shift_templates"("templateCode");

-- CreateIndex
CREATE INDEX "shift_templates_name_idx" ON "shift_templates"("name");

-- CreateIndex
CREATE INDEX "shifts_employeeId_idx" ON "shifts"("employeeId");

-- CreateIndex
CREATE INDEX "shifts_templateId_idx" ON "shifts"("templateId");

-- CreateIndex
CREATE INDEX "shifts_workDate_idx" ON "shifts"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_employeeId_workDate_templateId_key" ON "shifts"("employeeId", "workDate", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_shiftId_key" ON "attendances"("shiftId");

-- CreateIndex
CREATE INDEX "attendances_employeeId_idx" ON "attendances"("employeeId");

-- CreateIndex
CREATE INDEX "attendances_workDate_idx" ON "attendances"("workDate");

-- CreateIndex
CREATE INDEX "shift_registrations_employeeId_idx" ON "shift_registrations"("employeeId");

-- CreateIndex
CREATE INDEX "shift_registrations_templateId_idx" ON "shift_registrations"("templateId");

-- CreateIndex
CREATE INDEX "shift_registrations_registerDate_idx" ON "shift_registrations"("registerDate");

-- CreateIndex
CREATE UNIQUE INDEX "shift_registrations_employeeId_registerDate_templateId_key" ON "shift_registrations"("employeeId", "registerDate", "templateId");

-- CreateIndex
CREATE INDEX "tasks_branchId_workDate_templateId_idx" ON "tasks"("branchId", "workDate", "templateId");

-- CreateIndex
CREATE INDEX "tasks_templateId_idx" ON "tasks"("templateId");

-- CreateIndex
CREATE INDEX "tasks_assignedTo_idx" ON "tasks"("assignedTo");

-- CreateIndex
CREATE INDEX "tasks_branchId_idx" ON "tasks"("branchId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_configs_isSingleton_key" ON "attendance_configs"("isSingleton");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "shift_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_registrations" ADD CONSTRAINT "shift_registrations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "shift_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "shift_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business constraints not represented by Prisma schema syntax.
ALTER TABLE attendances ADD CONSTRAINT attendance_times_valid CHECK
("checkOut" IS NULL OR ("checkIn" IS NOT NULL AND "checkOut" >= "checkIn"));

ALTER TABLE attendances ADD CONSTRAINT attendance_penalty_valid CHECK ("penaltyAmount" >= 0);

ALTER TABLE tasks ADD CONSTRAINT task_assignment_valid CHECK
("assignedTo" IS NOT NULL OR ("branchId" IS NOT NULL AND "workDate" IS NOT NULL AND "templateId" IS NOT NULL));

ALTER TABLE attendance_configs ADD CONSTRAINT attendance_config_singleton CHECK ("isSingleton" = true);

ALTER TABLE attendance_configs ADD CONSTRAINT attendance_config_values_valid CHECK
("gracePeriodMinutes" >= 0 AND "checkoutWindowMinutes" >= 0 AND "earlyCheckinMinutes" >= 0
AND "doubleCheckinEarlyMinutes" >= 0 AND "doubleCheckinLateMinutes" >= 0
AND "latePenaltyPct" BETWEEN 0 AND 100 AND "earlyLeavePenaltyPct" BETWEEN 0 AND 100);
COMMIT;
