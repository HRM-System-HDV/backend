-- Redesign for the inspected empty local database. Never discard business rows.
BEGIN;
DO $$
DECLARE t text; has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'payouts', 'payslips'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)', t) INTO has_rows;
      IF has_rows THEN RAISE EXCEPTION 'Redesign stopped: table % has data; a data migration is required', t; END IF;
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS "bank_accounts", "payouts", "payslips";

CREATE OR REPLACE FUNCTION pad_code(value bigint, minimum_width integer) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT lpad(value::text, greatest(minimum_width, length(value::text)), '0') $$;
CREATE SEQUENCE IF NOT EXISTS payout_ref_seq;

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('monthly', 'hourly');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('chưa xác nhận', 'đã xác nhận', 'đã thanh toán');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT,
    "bankName" TEXT,
    "branchId" UUID,
    "balance" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "bankReference" TEXT NOT NULL DEFAULT 'GD-' || pad_code(nextval('payout_ref_seq'), 6),
    "debitAccountId" UUID,
    "debitAccountNumber" TEXT,
    "totalAmount" DECIMAL(15,0) NOT NULL,
    "content" TEXT,
    "beneficiaryCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "baseSalary" DECIMAL(15,0) NOT NULL,
    "bonus" DECIMAL(15,0) NOT NULL,
    "totalPenalty" DECIMAL(15,0) NOT NULL,
    "netSalary" DECIMAL(15,0) NOT NULL,
    "salaryType" "SalaryType" NOT NULL,
    "salaryRate" DECIMAL(15,0) NOT NULL,
    "workedHours" DECIMAL(10,2),
    "payoutId" UUID,
    "status" "PayslipStatus" NOT NULL DEFAULT 'chưa xác nhận',
    "confirmedBy" UUID,
    "confirmedAt" TIMESTAMPTZ,
    "branchId" UUID,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_accountNumber_key" ON "bank_accounts"("accountNumber");

-- CreateIndex
CREATE INDEX "bank_accounts_branchId_idx" ON "bank_accounts"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_bankReference_key" ON "payouts"("bankReference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payouts_debitAccountId_idx" ON "payouts"("debitAccountId");

-- CreateIndex
CREATE INDEX "payslips_branchId_idx" ON "payslips"("branchId");

-- CreateIndex
CREATE INDEX "payslips_payoutId_idx" ON "payslips"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_employeeId_month_key" ON "payslips"("employeeId", "month");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business constraints not represented by Prisma schema syntax.
ALTER TABLE payslips ADD CONSTRAINT payslip_confirmation_valid CHECK
((status = 'chưa xác nhận' AND "confirmedBy" IS NULL AND "confirmedAt" IS NULL)
OR (status IN ('đã xác nhận', 'đã thanh toán') AND "confirmedBy" IS NOT NULL AND "confirmedAt" IS NOT NULL));

ALTER TABLE payslips ADD CONSTRAINT payslip_amounts_valid CHECK
("salaryRate" >= 0 AND "baseSalary" >= 0 AND bonus >= 0 AND "totalPenalty" >= 0
AND "netSalary" = "baseSalary" + bonus - "totalPenalty");

ALTER TABLE payslips ADD CONSTRAINT payslip_period_valid CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE payslips ADD CONSTRAINT payslip_hours_valid CHECK
(("salaryType" = 'hourly' AND "workedHours" IS NOT NULL AND "workedHours" >= 0)
OR ("salaryType" = 'monthly' AND "workedHours" IS NULL));

ALTER TABLE bank_accounts ADD CONSTRAINT bank_balance_valid CHECK (balance >= 0);

CREATE UNIQUE INDEX bank_accounts_one_primary ON bank_accounts ("isPrimary") WHERE "isPrimary" = true;

ALTER TABLE payouts ADD CONSTRAINT payout_amounts_valid CHECK ("totalAmount" > 0 AND "beneficiaryCount" > 0);
ALTER TABLE payslips ADD CONSTRAINT payslip_paid_link_valid CHECK (status <> 'đã thanh toán' OR "payoutId" IS NOT NULL);

COMMIT;
