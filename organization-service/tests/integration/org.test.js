"use strict";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const {test,beforeEach} = require("node:test");
const request = require("supertest");
const identity = require("../../src/clients/IdentityClient");
identity.syncEmployeeToIdentity = async()=>({ok:true});
const app = require("../../src/app");
const service = require("../../src/services/OrgService");
const config = require("../../src/config");
const admin={"x-user-id":"00000000-0000-4000-8000-000000000001","x-user-role":"admin"};
const body={name:"Nguyễn Văn A",email:"a@company.test",salaryType:"monthly",salary:"7800000",standardWorkDays:26};
beforeEach(()=>service.resetForTests());
test("unauthenticated and staff catalog writes are denied",async()=> {
  assert.equal((await request(app).get("/api/employees")).status,401);
  assert.equal((await request(app).post("/api/branches").set({...admin,"x-user-role":"staff"}).send({name:"CN",address:"Hanoi"})).status,403);
  assert.equal((await request(app).post("/api/positions").set({...admin,"x-user-role":"manager"}).send({name:"Dev",positionCode:"DEV"})).status,403);
});
test("catalog UUID relations and direct employee lifecycle over HTTP",async()=> {
  const branch=await request(app).post("/api/branches").set(admin).send({name:"CN",address:"Hà Nội"}); assert.equal(branch.status,201);
  const dept=await request(app).post("/api/departments").set(admin).send({name:"IT",departmentCode:"IT"}); assert.equal(dept.status,201);
  const pos=await request(app).post("/api/positions").set(admin).send({name:"Dev",positionCode:"DEV",departmentId:dept.body.data.id}); assert.equal(pos.status,201);
  assert.equal((await request(app).post("/api/positions").set(admin).send({name:"Bad",positionCode:"BAD",status:"vô hiệu hóa"})).status,400);
  const created=await request(app).post("/api/employees").set(admin).send({...body,branchId:branch.body.data.id,departmentId:dept.body.data.id,positionId:pos.body.data.id});
  assert.equal(created.status,201); const id=created.body.data.id;
  const fetched=await request(app).get(`/api/employees/${id}`).set("x-internal-token",config.internalToken);
  assert.equal(fetched.status,200); assert.equal(fetched.body.data.salary,"7800000");
  const listed=await request(app).get(`/api/employees?branchId=${branch.body.data.id}`).set("x-internal-token",config.internalToken);
  assert.equal(listed.body.data.length,1);
  const deleted=await request(app).delete(`/api/employees/${id}`).set(admin);
  assert.equal(deleted.status,200); assert.equal(deleted.body.data.status,"nghỉ việc");
  assert.equal((await request(app).get(`/api/employees/${id}`).set(admin)).status,200);
});
test("staff only accesses own profile; role injection and legacy payload rejected",async()=> {
  const a=(await request(app).post("/api/employees").set(admin).send(body)).body.data;
  const b=(await request(app).post("/api/employees").set(admin).send({...body,email:"b@company.test"})).body.data;
  const staff={...admin,"x-user-role":"staff","x-employee-id":a.id};
  assert.equal((await request(app).get(`/api/employees/${b.id}`).set(staff)).status,403);
  assert.equal((await request(app).get("/api/employees").set(staff)).body.data.length,1);
  assert.equal((await request(app).put(`/api/employees/${a.id}`).set(staff).send({salary:"10000000"})).status,403);
  assert.equal((await request(app).put(`/api/employees/${a.id}`).set(staff).send({phone:"0901234567"})).status,200);
  assert.equal((await request(app).put(`/api/employees/${a.id}`).set(admin).send({systemRole:"admin"})).status,400);
  assert.equal((await request(app).get("/api/employees/NV-0001").set(admin)).status,400);
});
test("normalized emails unique and merged salary validation runs",async()=> {
  const created=await request(app).post("/api/employees").set(admin).send(body);
  assert.equal((await request(app).post("/api/employees").set(admin).send({...body,email:"A@COMPANY.TEST"})).status,409);
  const result=await request(app).put(`/api/employees/${created.body.data.id}`).set(admin).send({salaryType:"hourly"});
  assert.equal(result.status,400); assert.equal(result.body.error.code,"VALIDATION_ERROR");
});

test("manager can create, update, lock, unlock and delete departments; staff cannot write", async () => {
  const manager = { ...admin, "x-user-role": "manager" };
  const created = await request(app).post("/api/departments").set(manager).send({ name: "Operations", departmentCode: "OPS" });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.staff, 0);
  assert.equal(created.body.data.manager, "");
  assert.equal((await request(app).put(`/api/departments/${id}`).set(manager).send({ name: "Operations updated", status: "tạm dừng" })).status, 200);
  assert.equal((await request(app).put(`/api/departments/${id}`).set(manager).send({ status: "hoạt động" })).status, 200);
  // Trạng thái phòng ban/vị trí là enum phía BE ("hoạt động"/"tạm dừng"), không phải quy ước FE.
  assert.equal((await request(app).put(`/api/departments/${id}`).set(manager).send({ status: "vô hiệu hóa" })).status, 400);
  assert.equal((await request(app).post("/api/departments").set(admin).send({ name: "Bad", departmentCode: "BAD", status: "khóa" })).status, 400);
  const staff = { ...admin, "x-user-role": "staff" };
  assert.equal((await request(app).post("/api/departments").set(staff).send({ name: "Denied", departmentCode: "DENIED" })).status, 403);
  assert.equal((await request(app).put(`/api/departments/${id}`).set(staff).send({ name: "Denied" })).status, 403);
  assert.equal((await request(app).delete(`/api/departments/${id}`).set(staff)).status, 403);
  assert.equal((await request(app).delete(`/api/departments/${id}`).set(manager)).status, 200);
});

test("department counts only active staff (same as branches) and names/candidates use employee IDs", async () => {
  const branch = await service.createBranch({ name: "Branch A", address: "123 Test Street" }, { userId: admin["x-user-id"], role: "admin" });
  const dept = (await request(app).post("/api/departments").set(admin).send({ name: "Shared", departmentCode: "SHARED" })).body.data;
  const other = (await request(app).post("/api/departments").set(admin).send({ name: "Shared", departmentCode: "OTHER" })).body.data;
  const active = (await request(app).post("/api/employees").set(admin).send({ ...body, name: "Outside branch", departmentId: dept.id })).body.data;
  const resigned = (await request(app).post("/api/employees").set(admin).send({ ...body, email: "resigned@example.test", departmentId: dept.id, branchId: branch.id, status: "nghỉ việc" })).body.data;
  await request(app).post("/api/employees").set(admin).send({ ...body, email: "other@example.test", departmentId: other.id });
  const manager = { ...admin, "x-user-role": "manager", "x-branch-id": branch.id };
  const assigned = await request(app).put(`/api/departments/${dept.id}`).set(manager).send({ managerId: active.id });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.data.manager, active.name);
  // Cột "Nhân sự" của phòng ban đếm như chi nhánh: chỉ hồ sơ "đang làm".
  assert.equal(assigned.body.data.staff, 1);
  const list = await request(app).get("/api/departments").set(manager);
  assert.equal(list.body.data.find(row => row.id === dept.id).staff, 1);
  assert.equal(list.body.data.find(row => row.id === other.id).staff, 1);
  const detail = await request(app).get(`/api/departments/${dept.id}`).set(manager);
  assert.equal(detail.body.data.manager, active.name);
  assert.equal(detail.body.data.staff, 1);
  const candidates = await request(app).get(`/api/departments/${dept.id}/manager-candidates`).set(manager);
  assert.equal(candidates.status, 200);
  assert.deepEqual(candidates.body.data, [{ id: active.id, name: active.name }]);
  assert.equal((await request(app).get(`/api/departments/${dept.id}/manager-candidates`).set({ ...admin, "x-user-role": "staff" })).status, 403);
  assert.equal((await request(app).put(`/api/departments/${dept.id}`).set(manager).send({ managerId: resigned.id })).status, 400);
});
