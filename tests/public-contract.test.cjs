"use strict";
process.env.DATABASE_URL = "";
process.env.INTERNAL_API_TOKEN = "public-contract-test";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const request = require("../api-gateway/node_modules/supertest");
const admin = { "x-user-id": randomUUID(), "x-user-role": "admin" };

test("public date contract accepts DD/MM/YYYY, validates calendar dates, and preserves internal ISO and timestamps", async () => {
  const identity = require("../organization-service/src/clients/IdentityClient");
  identity.syncEmployeeToIdentity = async () => ({ ok: true });
  const app = require("../organization-service/src/app");
  const payload = { name: "Date contract", email: "date-contract@example.test", salaryType: "hourly", salary: "30000", birthDate: "29/02/2024", joinDate: "13/11/2026" };
  const created = await request(app).post("/api/employees").set(admin).send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.birthDate, "29/02/2024");
  assert.equal(created.body.data.joinDate, "13/11/2026");
  assert.match(created.body.data.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  const internal = await request(app).get(`/api/employees/${created.body.data.id}`).set("x-internal-token", process.env.INTERNAL_API_TOKEN);
  assert.equal(internal.body.data.birthDate, "2024-02-29");
  const invalid = await request(app).post("/api/employees").set(admin).send({ ...payload, email: "invalid-date@example.test", birthDate: "31/02/2026" });
  assert.equal(invalid.status, 400);
  const leavePath = `/api/employees/${created.body.data.id}/leave`;
  const tooEarly = await request(app).post(leavePath).set(admin).send({ resignedAt: "12/11/2026" });
  assert.equal(tooEarly.status, 400);
  const resigned = await request(app).post(leavePath).set(admin).send({ resignedAt: "14/11/2026" });
  assert.equal(resigned.status, 200);
  assert.equal(resigned.body.data.status, "nghỉ việc");
  assert.equal(resigned.body.data.resignedAt, "14/11/2026");
  const preserved = await request(app).get(`/api/employees/${created.body.data.id}`).set(admin);
  assert.equal(preserved.status, 200);
  assert.equal(preserved.body.data.name, payload.name);
  assert.equal(preserved.body.data.resignedAt, "14/11/2026");
});

test("shift API accepts the four agreed fields, checks employee branch, rejects note, and returns the public work date", async () => {
  const org = require("../work-service/src/clients/OrgClient");
  const employee = { id: randomUUID(), branchId: randomUUID(), status: "đang làm" };
  org.getEmployee = async () => employee;
  org.listEmployees = async () => [employee];
  const app = require("../work-service/src/app");
  const template = await request(app).post("/api/shift-templates").set(admin).send({ templateCode: "PUBLIC-CONTRACT", name: "Morning", startTime: "07:00", endTime: "12:00" });
  assert.equal(template.status, 201);
  const payload = { branchId: employee.branchId, employeeId: employee.id, templateId: template.body.data.id, workDate: "14/11/2026" };
  assert.equal((await request(app).post("/api/shifts").set(admin).send({ ...payload, branchId: randomUUID() })).status, 400);
  assert.equal((await request(app).post("/api/shifts").set(admin).send({ ...payload, note: "obsolete" })).status, 400);
  const created = await request(app).post("/api/shifts").set(admin).send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.branchId, employee.branchId);
  assert.equal(created.body.data.workDate, "14/11/2026");
  assert.equal("note" in created.body.data, false);
  const rows = await request(app).get("/api/shifts?workDate=14%2F11%2F2026").set(admin);
  assert.equal(rows.body.data.length, 1);
});

test("news and regulations use backend field names and public day format", async () => {
  const app = require("../integration-service/src/app");
  const news = await request(app).post("/api/news").set(admin).send({ title: "News", summary: "Summary", content: "Body", publishDate: "13/11/2026", tag: "News", branchId: null });
  assert.equal(news.status, 201, JSON.stringify(news.body));
  assert.equal(news.body.data.publishDate, "13/11/2026");
  const rule = await request(app).post("/api/regulations").set(admin).send({ regulationCode: "QD-CONTRACT", title: "Rule", summary: "Summary", content: "Body", category: "Rules", effectiveDate: "13/11/2026", scopeBranchId: null });
  assert.equal(rule.status, 201, JSON.stringify(rule.body));
  assert.equal(rule.body.data.regulationCode, "QD-CONTRACT");
  assert.equal(rule.body.data.effectiveDate, "13/11/2026");
});

test("payroll accepts and returns MM-YYYY publicly, while internal callers retain YYYY-MM", async () => {
  const employee = { id: randomUUID(), branchId: randomUUID(), salaryType: "hourly", salary: "30000" };
  require("../payroll-service/src/clients/OrgClient").getEmployeeById = async () => employee;
  require("../payroll-service/src/clients/WorkClient").getAttendance = async query => { assert.equal(query.month, "2026-11"); return []; };
  const app = require("../payroll-service/src/app");
  const created = await request(app).post("/api/payroll/payslips/generate").set(admin).send({ employeeId: employee.id, month: "11-2026", bonus: "7" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.month, "11-2026");
  assert.equal(created.body.data.netSalary, "7");
  const rows = await request(app).get("/api/payroll/payslips?month=11-2026").set(admin);
  assert.equal(rows.status, 200);
  assert.equal(rows.body.data.length, 1);
  const internal = await request(app).get(`/api/payroll/payslips/${created.body.data.id}`).set({ ...admin, "x-internal-token": process.env.INTERNAL_API_TOKEN });
  assert.equal(internal.body.data.month, "2026-11");
});
