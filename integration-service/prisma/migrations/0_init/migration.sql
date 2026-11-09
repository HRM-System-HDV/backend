-- CreateTable
CREATE TABLE "requests" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "targetEmployeeId" TEXT,
    "branchSlug" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "sourceShiftId" TEXT,
    "targetShiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "targetEmployeeId" TEXT,
    "branchSlug" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "requestType" TEXT,
    "shiftName" TEXT,
    "shiftDate" TEXT,
    "shiftTime" TEXT,
    "shiftHours" TEXT,
    "senderName" TEXT,
    "senderRole" TEXT,
    "senderPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "remindCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "remindCheckOut" BOOLEAN NOT NULL DEFAULT true,
    "remindShift" BOOLEAN NOT NULL DEFAULT true,
    "notifyTask" BOOLEAN NOT NULL DEFAULT true,
    "notifyLeave" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soap_gateway_configs" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "endpointUrl" TEXT NOT NULL,
    "wsdlUrl" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 8443,
    "securityMode" TEXT NOT NULL,
    "allowedIPs" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastPingTime" TEXT,
    "avgResponseTime" TEXT,
    "certExpiry" TEXT,
    "channel" TEXT DEFAULT 'Gateway (REST/SOAP)',

    CONSTRAINT "soap_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "tagTone" TEXT NOT NULL DEFAULT 'primary',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT NOT NULL DEFAULT 'Toàn công ty',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hiệu lực',
    "scope" TEXT NOT NULL DEFAULT 'Toàn công ty',
    "effectiveDate" TEXT NOT NULL,
    "expiryDate" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "attachments" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_configs" (
    "id" TEXT NOT NULL,
    "ssid" TEXT NOT NULL,
    "bssid" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wifi_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlogs" (
    "id" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_role" TEXT DEFAULT 'staff',
    "action" TEXT NOT NULL,
    "action_label" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backlogs_pkey" PRIMARY KEY ("id")
);

