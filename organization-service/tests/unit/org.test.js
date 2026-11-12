"use strict";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const {test,beforeEach} = require("node:test");
const identity = require("../../src/clients/IdentityClient");
identity.syncEmployeeToIdentity = async () => ({ok:true});
const service = require("../../src/services/OrgService");
const database = require("../../src/config/database");
const {normalize} = require("../../src/validators/orgValidator");
const admin = {userId:"admin-user",role:"admin"};
const employee = (extra={}) => ({name:"Nguyễn Văn A",email:"a@company.test",salaryType:"monthly",salary:"7800000",standardWorkDays:26,...extra});
beforeEach(() => service.resetForTests());
test("UUID IDs, business codes, salary and native dates follow new schema",async () => {
  const branch = await service.createBranch({name:"Chi nhánh 1"},admin);
  const dept = await service.createDepartment({name:"Phát triển",departmentCode:"DEPT-IT"},admin);
  const pos = await service.createPosition({name:"Lập trình viên",positionCode:"POS-DEV",departmentId:dept.id},admin);
  const row = await service.createEmployee(employee({email:" A@Company.Test ",branchId:branch.id,departmentId:dept.id,positionId:pos.id,joinDate:"2026-11-01"}),admin);
  assert.match(row.id,/^[0-9a-f-]{36}$/); assert.equal(row.employeeCode,"NV-00001");
  assert.equal(row.salary,"7800000"); assert.equal(row.email,"a@company.test"); assert.equal(row.joinDate,"2026-11-01");
  for (const field of ["baseSalary","hourlySalary","branchSlug","systemRole","updatedAt"]) assert.equal(field in row,false);
});
test("salary type constraints apply to create and merged updates",async () => {
  await assert.rejects(service.createEmployee(employee({standardWorkDays:null}),admin),/số công/);
  await assert.rejects(service.createEmployee(employee({salaryType:"hourly"}),admin),/lương giờ/);
  const row = await service.createEmployee(employee(),admin);
  await assert.rejects(service.updateEmployee(row.id,{salaryType:"hourly"},admin),/lương giờ/);
  const hourly = await service.updateEmployee(row.id,{salaryType:"hourly",standardWorkDays:null,salary:"30000"},admin);
  assert.equal(hourly.standardWorkDays,null);
  await assert.rejects(service.updateEmployee(row.id,{salary:"-1"},admin),/Lương/);
  await assert.rejects(service.updateEmployee(row.id,{joinDate:"2026-02-30"},admin),/YYYY-MM-DD/);
  await assert.rejects(service.updateEmployee(row.id,{joinDate:"2026-11-10",resignedAt:"2026-11-01"},admin),/Ngày nghỉ/);
});
test("rejects old fields and duplicate normalized email without fallback",async () => {
  await service.createEmployee(employee(),admin);
  await assert.rejects(service.createEmployee(employee({email:"A@COMPANY.TEST"}),admin),error=>error.code === "DUPLICATE_RESOURCE");
  assert.throws(()=>normalize("employee",{systemRole:"admin"},true),/Trường không hợp lệ/);
  assert.throws(()=>normalize("employee",{baseSalary:1},true),/Trường không hợp lệ/);
});
test("position and managers must belong to the correct organization",async () => {
  const dept = await service.createDepartment({name:"IT",departmentCode:"IT"},admin);
  const pos = await service.createPosition({name:"Dev",positionCode:"DEV",departmentId:dept.id},admin);
  await assert.rejects(service.createEmployee(employee({positionId:pos.id}),admin),/Vị trí/);
  const branch = await service.createBranch({name:"CN"},admin);
  const row = await service.createEmployee(employee({branchId:branch.id,departmentId:dept.id,positionId:pos.id}),admin);
  await service.updateBranch(branch.id,{managerId:row.id},admin);
  await assert.rejects(service.updateEmployee(row.id,{branchId:null},admin),/thay người phụ trách/);
  await assert.rejects(service.updateBranch(branch.id,{managerId:"00000000-0000-4000-8000-000000000001"},admin),error=>error.status === 404);
});
test("staff reads/edits self, manager only own branch, internal reads canonical data",async () => {
  const b1 = await service.createBranch({name:"CN1"},admin), b2 = await service.createBranch({name:"CN2"},admin);
  const one = await service.createEmployee(employee({branchId:b1.id}),admin);
  const two = await service.createEmployee(employee({email:"b@company.test",branchId:b2.id}),admin);
  const staff = {userId:"u1",employeeId:one.id,role:"staff",branchId:b1.id};
  assert.equal((await service.listEmployees({},staff)).length,1);
  await assert.rejects(service.getEmployee(two.id,staff),error=>error.status===403);
  await assert.rejects(service.updateEmployee(one.id,{salary:"1"},staff),error=>error.status===403);
  await service.updateEmployee(one.id,{phone:"0901234567"},staff);
  const manager={userId:"m1",role:"manager",branchId:b1.id};
  assert.equal((await service.listEmployees({branchId:b2.id},manager))[0].id,one.id);
  await assert.rejects(service.updateEmployee(one.id,{branchId:null},manager),error=>error.status===403);
  await assert.rejects(service.removeEmployee(two.id,manager),error=>error.status===403);
  assert.equal((await service.getEmployee(two.id,{internal:true})).salary,"7800000");
});
test("resignation preserves employee and attachments, synchronizes the account",async () => {
  let action;
  identity.syncEmployeeToIdentity=async (_row,command)=>{action=command;return {ok:true};};
  const row = await service.createEmployee(employee({cccdFront:"/api/files/cccd/front.jpg"}),admin);
  const resigned=await service.removeEmployee(row.id,admin,"2026-11-12");
  assert.equal(resigned.status,"nghỉ việc"); assert.equal(action,"resign");
  assert.equal((await service.getEmployee(row.id,admin)).cccdFront,row.cccdFront);
});
test("Prisma errors propagate instead of silently writing memory",async () => {
  const original=database.getPrisma;
  database.getPrisma=()=>({branch:{findMany:async()=>{throw new Error("DB unavailable");}}});
  try {await assert.rejects(service.listBranches({},admin),/DB unavailable/);} finally {database.getPrisma=original;}
});