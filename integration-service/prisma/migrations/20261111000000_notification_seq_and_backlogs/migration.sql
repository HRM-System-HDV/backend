-- Sequence cho sinh ID thông báo chống race condition
CREATE SEQUENCE IF NOT EXISTS notification_id_seq START WITH 1;

-- Bảng backlogs chuẩn hóa Prisma
CREATE TABLE IF NOT EXISTS "backlogs" (
    "id" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_role" TEXT DEFAULT 'staff',
    "action" TEXT NOT NULL,
    "action_label" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backlogs_pkey" PRIMARY KEY ("id")
);

-- Đồng bộ giá trị sequence thông báo nếu đã có dữ liệu cũ
DO $$
DECLARE
    max_val INT;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 4) AS INTEGER)), 0) INTO max_val
    FROM "notifications" WHERE id LIKE 'TB-%' AND SUBSTRING(id FROM 4) ~ '^[0-9]+$';
    IF max_val > 0 THEN
        PERFORM setval('notification_id_seq', max_val);
    END IF;
END $$;
