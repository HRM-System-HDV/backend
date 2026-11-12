"use strict";

// Chạy chủ động sau migration. Các bản ghi kiểm chứng đều rollback, không seed dữ liệu.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const rollback = new Error("ROLLBACK_VERIFICATION");
const day = new Date("2026-01-10T00:00:00Z");
async function rejected(tx, operation) {
  await tx.$executeRawUnsafe("SAVEPOINT validation_probe");
  try {
    await assert.rejects(operation);
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT validation_probe");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT validation_probe");
  }
}
const checks = {
  async identity(tx) {
    const user = await tx.user.create({ data: { email: "verify@example.test", name: "Verification", passwordHash: "verification-only" } });
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    const device = await tx.deviceSession.create({ data: { userId: user.id, deviceName: "Verification" } });
    await tx.refreshToken.create({ data: { token: randomUUID(), userId: user.id, deviceSessionId: device.id, expiresAt: new Date(Date.now() + 60000) } });
    await rejected(tx, () => tx.user.create({ data: { email: user.email, name: "Duplicate", passwordHash: "verification-only" } }));
  },
  async organization(tx) {
    const branch = await tx.branch.create({ data: { name: "Verification", branchCode: "VERIFY-BRANCH" } });
    const data = { employeeCode: "VERIFY-EMPLOYEE", name: "Verification", email: "verify@example.test", branchId: branch.id, salaryType: "monthly", salary: "7800000", standardWorkDays: 26 };
    await rejected(tx, () => tx.employee.create({ data: { ...data, standardWorkDays: 0 } }));
    const employee = await tx.employee.create({ data });
    await tx.branch.update({ where: { id: branch.id }, data: { managerId: employee.id } });
    await rejected(tx, () => tx.employee.update({ where: { id: employee.id }, data: { salary: "-1" } }));
  },
  async work(tx) {
    const template = await tx.shiftTemplate.create({ data: { templateCode: "VERIFY-TEMPLATE", name: "Verification", startTime: "07:00", endTime: "12:00" } });
    const data = { employeeId: randomUUID(), workDate: day, templateId: template.id, scheduledStart: "07:00", scheduledEnd: "12:00" };
    const shift = await tx.shift.create({ data });
    await rejected(tx, () => tx.shift.create({ data }));
    const attendance = { employeeId: data.employeeId, shiftId: shift.id, workDate: day, checkIn: new Date("2026-01-10T00:00:00Z"), checkOut: new Date("2026-01-10T05:00:00Z"), status: "present" };
    await tx.attendance.create({ data: attendance });
    await rejected(tx, () => tx.attendance.create({ data: attendance }));
    await rejected(tx, () => tx.task.create({ data: { title: "Missing assignment" } }));
    await tx.task.create({ data: { title: "Personal", assignedTo: data.employeeId } });
    await tx.attendanceConfig.create({ data: {} });
    await rejected(tx, () => tx.attendanceConfig.create({ data: { isSingleton: false } }));
    await rejected(tx, () => tx.attendanceConfig.updateMany({ data: { doubleCheckinLateMinutes: -1 } }));
  },
  async payroll(tx) {
    const bank = await tx.bankAccount.create({ data: { accountNumber: "VERIFY-BANK", balance: "1000000", isPrimary: true } });
    await rejected(tx, () => tx.bankAccount.create({ data: { accountNumber: "VERIFY-SECOND", isPrimary: true } }));
    const payslip = await tx.payslip.create({ data: { employeeId: randomUUID(), month: "2026-01", baseSalary: "300000", bonus: "0", totalPenalty: "0", netSalary: "300000", salaryType: "monthly", salaryRate: "7800000" } });
    await rejected(tx, () => tx.payslip.update({ where: { id: payslip.id }, data: { status: "confirmed" } }));
    await tx.payslip.update({ where: { id: payslip.id }, data: { status: "confirmed", confirmedBy: randomUUID(), confirmedAt: new Date() } });
    const payout = await tx.payout.create({ data: { bankReference: "VERIFY-PAYOUT", debitAccountId: bank.id, totalAmount: "300000", beneficiaryCount: 1, idempotencyKey: randomUUID(), status: "success" } });
    await tx.payslip.update({ where: { id: payslip.id }, data: { status: "paid", payoutId: payout.id } });
    await rejected(tx, () => tx.bankAccount.update({ where: { id: bank.id }, data: { balance: "-1" } }));
  },
  async integration(tx) {
    await tx.soapGatewayConfig.create({ data: { endpointUrl: "https://example.test", wsdlUrl: "https://example.test/wsdl", serviceName: "Verification", securityMode: "none" } });
    await rejected(tx, () => tx.soapGatewayConfig.create({ data: { isSingleton: false, endpointUrl: "https://example.test", wsdlUrl: "https://example.test/wsdl", serviceName: "Verification", securityMode: "none" } }));
    const data = { type: "advance", employeeId: randomUUID(), title: "Verification", content: "Verification" };
    await rejected(tx, () => tx.request.create({ data }));
    const request = await tx.request.create({ data: { ...data, advanceAmount: "100000" } });
    await rejected(tx, () => tx.request.update({ where: { id: request.id }, data: { status: "approved" } }));
    await tx.request.update({ where: { id: request.id }, data: { status: "approved", reviewedBy: randomUUID(), reviewedAt: new Date() } });
    await tx.notification.create({ data: { targetEmployeeId: data.employeeId, requestId: request.id, title: "Verification", body: "Verification" } });
  },
};

(async () => {
  for (const [service, check] of Object.entries(checks)) {
    const cwd = path.resolve(__dirname, "..", `${service}-service`);
    const envFile = path.join(cwd, ".env");
    const env = fs.existsSync(envFile) ? require(path.join(cwd, "node_modules/dotenv")).parse(fs.readFileSync(envFile)) : {};
    const url = env.DATABASE_URL || process.env.DATABASE_URL;
    if (!url) throw new Error(`${service}: DATABASE_URL required`);
    const { PrismaClient } = require(path.join(cwd, "node_modules/@prisma/client"));
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      try {
        await db.$transaction(async tx => { await check(tx); throw rollback; }, { timeout: 15000 });
        throw new Error("Verification transaction was not rolled back");
      } catch (error) { if (error !== rollback) throw error; }
      console.log(`${service}: real PostgreSQL writes, constraints and rollback OK`);
    } finally { await db.$disconnect(); }
  }
})().catch(error => { console.error(error.code || error.name, error.message); process.exitCode = 1; });
