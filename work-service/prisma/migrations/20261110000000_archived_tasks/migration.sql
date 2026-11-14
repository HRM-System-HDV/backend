-- Kho lưu trữ nhiệm vụ hoàn thành cũ (tính năng Lưu trữ, chỉ admin).
CREATE TABLE IF NOT EXISTS "archived_tasks" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assignedTo" TEXT,
  "branchSlug" TEXT,
  "dueDate" TEXT,
  "status" TEXT NOT NULL,
  "sourceType" TEXT,
  "assignedByName" TEXT,
  "shiftName" TEXT,
  "priority" TEXT,
  "assignedToEmail" TEXT,
  "assignedToName" TEXT,
  "completedAt" TEXT,
  "requirePhoto" BOOLEAN,
  "proofPhotoUrl" TEXT,
  "photoSubmittedBy" TEXT,
  "photoSubmittedAt" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archiveBatchId" TEXT NOT NULL,
  CONSTRAINT "archived_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "archived_tasks_archivedAt_idx" ON "archived_tasks"("archivedAt");
CREATE INDEX IF NOT EXISTS "archived_tasks_createdAt_idx" ON "archived_tasks"("createdAt");