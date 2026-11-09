-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "manager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "staff" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "manager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'hoạt động',
    "staff" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "gender" TEXT,
    "birthDate" TEXT,
    "province" TEXT,
    "ward" TEXT,
    "street" TEXT,
    "cccd" TEXT,
    "issueDate" TEXT,
    "issuePlace" TEXT,
    "cccdFront" TEXT,
    "cccdBack" TEXT,
    "avatar" TEXT,
    "branchSlug" TEXT,
    "department" TEXT,
    "role" TEXT,
    "systemRole" TEXT NOT NULL DEFAULT 'staff',
    "status" TEXT NOT NULL DEFAULT 'đang làm',
    "joinDate" TEXT,
    "resignedAt" TIMESTAMP(3),
    "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salaryType" TEXT NOT NULL DEFAULT 'monthly',
    "hourlySalary" DOUBLE PRECISION,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_slug_key" ON "branches"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

