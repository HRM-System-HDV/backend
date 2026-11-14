"use strict";
process.env.DATABASE_URL = "";
process.env.INTERNAL_API_TOKEN = "mobile-test-token";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const request = require("supertest");
const clients = require("../../src/clients/ServiceClient");
const app = require("../../src/app");
const branchId = randomUUID(), otherBranch = randomUUID();
const employee = {id: randomUUID(), branchId, name: "Sender", salary: "secret"};
const target = {id: randomUUID(), branchId, name: "Target", cccd: "secret"};
const resigned = {id: randomUUID(), branchId, name: "Resigned", status: "nghỉ việc"};
const outsider = {id: randomUUID(), branchId: otherBranch, name: "Other"};
const source = {id: randomUUID(), employeeId: employee.id, workDate: "2099-01-01", templateId: randomUUID(), scheduledStart: "07:00", scheduledEnd: "12:00", status: "đang làm", attendance: null};
const next = {...source, id: randomUUID(), employeeId: target.id, workDate: "2099-01-02"};
const headers = {"x-user-id": randomUUID(), "x-user-role": "staff", "x-employee-id": employee.id, "x-branch-id": branchId};
clients.employee = async id => [employee, target, outsider].find(e => e.id === id);
clients.employees = async () => [employee, target, resigned, outsider];
clients.shift = async id => id === source.id ? source : next;
clients.shifts = async query => query.employeeId ? [next] : [source, next, {...next, id: randomUUID(), employeeId: outsider.id}];
clients.attendanceConfig = async () => ({shiftSwapMode: "mutual_acceptance"});

test("mobile gets same-branch swap options without private profiles or attendance", async () => {
  const res = await request(app).get(`/api/requests/shift-options?sourceShiftId=${source.id}`).set(headers).expect(200);
  assert.deepEqual(res.body.data.employees, [{id: target.id, name: target.name}]);
  assert.equal(res.body.data.shifts.length, 1);
  assert.equal(res.body.data.shifts[0].id, next.id);
  assert.equal("attendance" in res.body.data.shifts[0], false);
  await request(app).get(`/api/requests/shift-options?sourceShiftId=${source.id}`).expect(401);
  await request(app).get(`/api/requests/shift-options?sourceShiftId=${source.id}`).set({...headers, "x-employee-id": target.id}).expect(403);
  await request(app).get(`/api/requests/shift-options?sourceShiftId=${source.id}`).set({...headers, "x-user-role": "manager", "x-branch-id": otherBranch}).expect(403);
});

test("mobile leave, cover, swap and supplement payloads are accepted", async () => {
  const common = {employeeId: employee.id, title: "Mobile request", content: "Reason"};
  for (const fields of [
    {type: "leave", leaveStartDate: "2099-01-01", leaveEndDate: "2099-01-01"},
    {type: "shift_swap", sourceShiftId: source.id, targetEmployeeId: target.id},
    {type: "shift_swap", sourceShiftId: source.id, targetEmployeeId: target.id, targetShiftId: next.id},
    {type: "work_supplement", sourceShiftId: source.id, requestedCheckIn: "2020-01-01T00:00:00Z", requestedCheckOut: "2020-01-01T05:00:00Z"},
  ]) {
    const res = await request(app).post('/api/requests').set(headers).send({...common, ...fields}).expect(201);
    assert.equal(res.body.data.employeeId, employee.id);
    assert.equal(res.body.data.status, "pending");
  }
});
