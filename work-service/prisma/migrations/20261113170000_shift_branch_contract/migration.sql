BEGIN;
ALTER TABLE "shifts" ADD COLUMN "branchId" UUID;
ALTER TABLE "shifts" DROP COLUMN "note";
CREATE INDEX "shifts_branchId_idx" ON "shifts"("branchId");
COMMIT;
