BEGIN;

ALTER TABLE "payslips"
  ADD COLUMN "penaltyOverride" DECIMAL(15,0),
  ADD COLUMN "adjustmentReason" TEXT;

ALTER TABLE "payslips" ADD CONSTRAINT "payslip_penalty_override_valid"
  CHECK ("penaltyOverride" IS NULL OR "penaltyOverride" >= 0);

COMMIT;
