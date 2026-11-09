-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchSlug" TEXT,
    "date" TEXT NOT NULL,
    "template" TEXT,
    "scheduledStart" TEXT,
    "scheduledEnd" TEXT,
    "checkIn" TEXT,
    "checkOut" TEXT,
    "status" TEXT NOT NULL DEFAULT 'đang làm',
    "note" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT,
    "date" TEXT NOT NULL,
    "checkIn" TEXT,
    "checkOut" TEXT,
    "penaltyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "penaltyNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'present',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_configs" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "latePenaltyAmount" INTEGER NOT NULL DEFAULT 20000,
    "earlyLeavePenaltyAmount" INTEGER NOT NULL DEFAULT 0,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 5,
    "autoCloseShift" BOOLEAN NOT NULL DEFAULT false,
    "shiftSwapMode" TEXT NOT NULL DEFAULT 'manual',
    "latePenaltyPct" INTEGER NOT NULL DEFAULT 10,
    "earlyLeavePenaltyPct" INTEGER NOT NULL DEFAULT 10,
    "earlyCheckinMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxPenaltiesPerMonth" INTEGER NOT NULL DEFAULT 10,
    "deductOnCheckout" BOOLEAN NOT NULL DEFAULT true,
    "allowDoubleCheckin" BOOLEAN NOT NULL DEFAULT true,
    "maxCheckinsPerDay" INTEGER NOT NULL DEFAULT 3,
    "maxSwapsPerMonth" INTEGER NOT NULL DEFAULT 3,
    "requireReasonSwap" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "attendance_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_registrations" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "branchSlug" TEXT,
    "week" TEXT,
    "shiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedTo" TEXT,
    "branchSlug" TEXT,
    "dueDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceType" TEXT DEFAULT 'manager',
    "assignedByName" TEXT,
    "shiftName" TEXT,
    "priority" TEXT DEFAULT 'normal',
    "assignedToEmail" TEXT,
    "assignedToName" TEXT,
    "completedAt" TEXT,
    "requirePhoto" BOOLEAN DEFAULT false,
    "proofPhotoUrl" TEXT,
    "photoSubmittedBy" TEXT,
    "photoSubmittedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

