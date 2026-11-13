-- Preserve the calendar day of existing deadlines at midnight in Vietnam.
ALTER TABLE "tasks" ALTER COLUMN "dueDate" TYPE TIMESTAMPTZ(3)
USING ("dueDate"::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
