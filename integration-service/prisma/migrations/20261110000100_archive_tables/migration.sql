-- Kho lưu trữ đơn từ và thông báo cũ (tính năng Lưu trữ, chỉ admin).
CREATE TABLE IF NOT EXISTS "archived_requests" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "targetEmployeeId" TEXT,
  "branchSlug" TEXT,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "status" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "sourceShiftId" TEXT,
  "targetShiftId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archiveBatchId" TEXT NOT NULL,
  CONSTRAINT "archived_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "archived_requests_archivedAt_idx" ON "archived_requests"("archivedAt");
CREATE INDEX IF NOT EXISTS "archived_requests_createdAt_idx" ON "archived_requests"("createdAt");

CREATE TABLE IF NOT EXISTS "archived_notifications" (
  "id" TEXT NOT NULL,
  "targetEmployeeId" TEXT,
  "branchSlug" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isRead" BOOLEAN NOT NULL,
  "metadata" JSONB,
  "requestType" TEXT,
  "shiftName" TEXT,
  "shiftDate" TEXT,
  "shiftTime" TEXT,
  "shiftHours" TEXT,
  "senderName" TEXT,
  "senderRole" TEXT,
  "senderPhone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archiveBatchId" TEXT NOT NULL,
  CONSTRAINT "archived_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "archived_notifications_archivedAt_idx" ON "archived_notifications"("archivedAt");
CREATE INDEX IF NOT EXISTS "archived_notifications_createdAt_idx" ON "archived_notifications"("createdAt");