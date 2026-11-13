"use strict";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const request = require("supertest");
const identity = require("../../src/clients/IdentityClient");
const service = require("../../src/services/OrgService");
const app = require("../../src/app");
const roles = new Map();
const admin = { userId: "admin", role: "admin" };
const headers = { "x-user-id": "admin", "x-user-role": "admin" };
const branch = name => service.createBranch({ name, address: "Hà Nội" }, admin);
async function employee(branchId, systemRole = "staff", status = "đang làm") {
  const row = await service.createEmployee({ name: "Cùng tên", email: `${require("node:crypto").randomUUID()}@test.local`, branchId, salaryType: "hourly", salary: "30000", status }, admin);
  if (systemRole) roles.set(row.id, systemRole);
  return row;
}
beforeEach(() => {
  service.resetForTests(); roles.clear();
  identity.syncEmployeeToIdentity = async () => ({ ok: true });
  identity.getEmployeeRoles = async ids => ids.filter(id => roles.has(id)).map(employeeId => ({ employeeId, systemRole: roles.get(employeeId) }));
});

test("branch HTTP input validates address/status and rejects display-only fields", async () => {
  for (const payload of [{ name: "CN" }, { name: "CN", address: " " }, { name: "CN", address: null }, { name: "CN", address: "HN", status: "active" }, { name: "CN", address: "HN", staff: 5 }, { name: "CN", address: "HN", manager: "Name" }]) {
    assert.equal((await request(app).post("/api/branches").set(headers).send(payload)).status, 400);
  }
  const response = await request(app).post("/api/branches").set(headers).send({ name: " CN ", address: " HN ", managerId: null, status: "hoạt động" });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.name, "CN");
  assert.equal(response.body.data.address, "HN");
  assert.equal(response.body.data.managerId, null);
  assert.equal(response.body.data.manager, "");
  assert.equal(response.body.data.staff, 0);
  assert.match(response.body.data.branchCode, /^CN-/);
  assert.equal((await request(app).put(`/api/branches/${response.body.data.id}`).set(headers).send({ address: " " })).status, 400);
});

test("only active in-branch Identity managers/admins can be assigned; reads derive name and headcount", async () => {
  const a = await branch("A"), b = await branch("B");
  const manager = await employee(a.id, "manager");
  const administrator = await employee(a.id, "admin");
  const staff = await employee(a.id, "staff");
  const unlinked = await employee(a.id, null);
  const resigned = await employee(a.id, "manager", "nghỉ việc");
  const disabled = await employee(a.id, "manager", "vô hiệu hóa");
  const outsider = await employee(b.id, "manager");
  const candidates = await request(app).get(`/api/branches/${a.id}/manager-candidates`).set(headers);
  assert.equal(candidates.status, 200);
  assert.deepEqual(candidates.body.data.map(row => row.id).sort(), [manager.id, administrator.id].sort());
  assert.deepEqual(Object.keys(candidates.body.data[0]).sort(), ["id", "name", "systemRole"]);
  for (const row of [staff, unlinked, resigned, disabled, outsider]) {
    await assert.rejects(service.updateBranch(a.id, { managerId: row.id }, admin), error => error.status === 400);
  }
  const updated = await service.updateBranch(a.id, { managerId: manager.id }, admin);
  assert.equal(updated.managerId, manager.id);
  assert.equal(updated.manager, manager.name);
  assert.equal(updated.staff, 4);
  await service.updateEmployee(manager.id, { name: "Tên mới" }, admin);
  assert.equal((await service.getBranch(a.id, admin)).manager, "Tên mới");
  assert.equal((await service.listBranches({}, admin)).find(row => row.id === a.id).staff, 4);
  const cleared = await service.updateBranch(a.id, { managerId: null }, admin);
  assert.equal(cleared.manager, ""); assert.equal(cleared.managerId, null);
});

test("Manager creates branches and only edits/deletes own branch; Staff cannot write", async () => {
  const a = await branch("A"), b = await branch("B");
  const manager = { ...headers, "x-user-role": "manager", "x-branch-id": a.id };
  const staff = { ...manager, "x-user-role": "staff" };
  assert.equal((await request(app).post("/api/branches").set(manager).send({ name: "C", address: "HN" })).status, 201);
  assert.equal((await request(app).get("/api/branches").set(manager)).body.data.length, 3);
  assert.equal((await request(app).put(`/api/branches/${a.id}`).set(manager).send({ status: "vô hiệu hóa" })).status, 200);
  assert.equal((await request(app).put(`/api/branches/${b.id}`).set(manager).send({ name: "Other" })).status, 403);
  assert.equal((await request(app).delete(`/api/branches/${b.id}`).set(manager)).status, 403);
  assert.equal((await request(app).get(`/api/branches/${b.id}/manager-candidates`).set(manager)).status, 403);
  for (const method of ["post", "put", "delete"]) {
    assert.equal((await request(app)[method](method === "post" ? "/api/branches" : `/api/branches/${a.id}`).set(staff).send({ name: "No", address: "HN" })).status, 403);
  }
  assert.equal((await request(app).get(`/api/branches/${a.id}/manager-candidates`).set(staff)).status, 403);
  assert.equal((await request(app).delete(`/api/branches/${a.id}`).set(manager)).status, 200);
});

test("Identity failure prevents a new assignment without changing branch data", async () => {
  const a = await branch("A"), manager = await employee(a.id, "manager");
  identity.getEmployeeRoles = async () => { throw Object.assign(new Error("Identity unavailable"), { status: 503 }); };
  await assert.rejects(service.updateBranch(a.id, { name: "Changed", managerId: manager.id }, admin), error => error.status === 503);
  const current = await service.getBranch(a.id, admin);
  assert.equal(current.name, "A"); assert.equal(current.managerId, null);
});
