-- Redesign for the inspected empty local database. Never discard business rows.
BEGIN;
DO $$
DECLARE t text; has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'departments', 'employees', 'positions'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)', t) INTO has_rows;
      IF has_rows THEN RAISE EXCEPTION 'Redesign stopped: table % has data; a data migration is required', t; END IF;
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS "branches", "departments", "employees", "positions";

CREATE OR REPLACE FUNCTION pad_code(value bigint, minimum_width integer) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT lpad(value::text, greatest(minimum_width, length(value::text)), '0') $$;
CREATE SEQUENCE IF NOT EXISTS branch_code_seq;
CREATE SEQUENCE IF NOT EXISTS employee_code_seq;

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('monthly', 'hourly');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "branchCode" TEXT NOT NULL DEFAULT 'CN-' || pad_code(nextval('branch_code_seq'), 5),
    "name" TEXT NOT NULL,
    "address" TEXT,
    "managerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "departmentCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "positionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" UUID,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL DEFAULT 'NV-' || pad_code(nextval('employee_code_seq'), 5),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "gender" TEXT,
    "birthDate" DATE,
    "province" TEXT,
    "ward" TEXT,
    "street" TEXT,
    "cccd" TEXT,
    "issueDate" DATE,
    "issuePlace" TEXT,
    "cccdFront" TEXT,
    "cccdBack" TEXT,
    "avatar" TEXT,
    "branchId" UUID,
    "departmentId" UUID,
    "positionId" UUID,
    "status" TEXT NOT NULL DEFAULT 'đang làm',
    "resignedAt" DATE,
    "joinDate" DATE,
    "salaryType" "SalaryType" NOT NULL,
    "salary" DECIMAL(15,0) NOT NULL,
    "standardWorkDays" INTEGER,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_branchCode_key" ON "branches"("branchCode");

-- CreateIndex
CREATE INDEX "branches_managerId_idx" ON "branches"("managerId");

-- CreateIndex
CREATE INDEX "branches_name_idx" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_departmentCode_key" ON "departments"("departmentCode");

-- CreateIndex
CREATE INDEX "departments_managerId_idx" ON "departments"("managerId");

-- CreateIndex
CREATE INDEX "departments_name_idx" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "positions_positionCode_key" ON "positions"("positionCode");

-- CreateIndex
CREATE INDEX "positions_departmentId_idx" ON "positions"("departmentId");

-- CreateIndex
CREATE INDEX "positions_name_idx" ON "positions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_branchId_idx" ON "employees"("branchId");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_positionId_idx" ON "employees"("positionId");

-- CreateIndex
CREATE INDEX "employees_name_idx" ON "employees"("name");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Business constraints not represented by Prisma schema syntax.
ALTER TABLE employees ADD CONSTRAINT employee_salary_valid CHECK
(salary >= 0 AND (("salaryType" = 'monthly' AND "standardWorkDays" IS NOT NULL
AND "standardWorkDays" > 0) OR ("salaryType" = 'hourly' AND "standardWorkDays" IS NULL)));

ALTER TABLE employees ADD CONSTRAINT employee_dates_valid CHECK
("resignedAt" IS NULL OR "joinDate" IS NULL OR "resignedAt" >= "joinDate");
COMMIT;
