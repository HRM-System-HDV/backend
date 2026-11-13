"use strict";
process.env.DATABASE_URL = "";
const assert = require("node:assert/strict");
const {test,beforeEach} = require("node:test");
const identity = require("../../src/clients/IdentityClient");
identity.syncEmployeeToIdentity = async () => ({ok:true});
identity.getEmployeeRoles = async ids => ids.map(employeeId => ({employeeId,systemRole:"manager"}));
const service = require("../../src/services/OrgService");
const database = require("../../src/config/database");
const {normalize} = require("../../src/validators/orgValidator");
const admin = {userId:"admin-user",role:"admin"};
const employee = (extra={}) => ({name:"Nguyễn Văn A",email:"a@company.test",salaryType:"monthly",salary:"7800000",standardWorkDays:26,...extra});
beforeEach(() => service.resetForTests());
test("UUID IDs, business codes, salary and native dates follow new schema",async () => {
  const branch = await service.createBranch({address:"Hanoi",name:"Chi nhánh 1"},admin);
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
  const branch = await service.createBranch({address:"Hanoi",name:"CN"},admin);
  const row = await service.createEmployee(employee({branchId:branch.id,departmentId:dept.id,positionId:pos.id}),admin);
  await service.updateBranch(branch.id,{managerId:row.id},admin);
  await assert.rejects(service.updateEmployee(row.id,{branchId:null},admin),/thay người phụ trách/);
  await assert.rejects(service.updateBranch(branch.id,{managerId:"00000000-0000-4000-8000-000000000001"},admin),error=>error.status === 404);
});
test("staff reads/edits self, manager only own branch, internal reads canonical data",async () => {
  const b1 = await service.createBranch({address:"Hanoi",name:"CN1"},admin), b2 = await service.createBranch({address:"Hanoi",name:"CN2"},admin);
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
// Q-B-04: quản lý CCCD phải đủ bộ (số, ngày cấp, nơi cấp) và định dạng đúng.
test("CCCD: đúng 12 chữ số, ngày cấp hợp lệ không sau hôm nay, phải đủ bộ thông tin",async () => {
  await assert.rejects(service.createEmployee(employee({email:"cccd1@company.test",cccd:"abc"}),admin),error=>error.status===400);
  await assert.rejects(service.createEmployee(employee({email:"cccd2@company.test",cccd:"12345678901"}),admin),error=>error.status===400);
  await assert.rejects(service.createEmployee(employee({email:"cccd3@company.test",cccd:"012345678901",issueDate:"2020-01-15"}),admin),/ngày cấp và nơi cấp/);
  await assert.rejects(service.createEmployee(employee({email:"cccd4@company.test",cccd:"012345678901",issueDate:"2999-01-01",issuePlace:"Hà Nội"}),admin),/sau ngày hiện tại/);
  await assert.rejects(service.createEmployee(employee({email:"cccd5@company.test",cccd:"012345678901",issueDate:"2020-01-15",issuePlace:"Hà Nội",cccdFront:"ảnh cccd không hợp lệ"}),admin),/đường dẫn ảnh/);
  const ok=await service.createEmployee(employee({email:"cccd6@company.test",cccd:"012345678901",issueDate:"2020-01-15",issuePlace:"Hà Nội",cccdFront:"/api/files/cccd/front.jpg",cccdBack:"https://files.local/cccd/back.jpg"}),admin);
  assert.equal(ok.cccd,"012345678901"); assert.equal(ok.issueDate,"2020-01-15"); assert.equal(ok.issuePlace,"Hà Nội");
  // Hồ sơ không có CCCD thì không bắt buộc đủ bộ.
  const plain=await service.createEmployee(employee({email:"cccd7@company.test"}),admin);
  assert.ok(!plain.cccd);
});
// Q-B-03: không gán người quản lý/người phụ trách là nhân viên đã nghỉ việc.
test("không gán người quản lý hoặc người phụ trách đang nghỉ việc",async () => {
  const branch=await service.createBranch({address:"Hanoi",name:"CN"},admin);
  const dept=await service.createDepartment({name:"IT",departmentCode:"IT"},admin);
  const row=await service.createEmployee(employee({branchId:branch.id,departmentId:dept.id}),admin);
  await service.updateBranch(branch.id,{managerId:row.id},admin);
  await service.updateDepartment(dept.id,{managerId:row.id},admin);
  await service.removeEmployee(row.id,admin,"2026-11-12");
  await assert.rejects(service.updateBranch(branch.id,{managerId:row.id},admin),/nghỉ việc/);
  await assert.rejects(service.updateDepartment(dept.id,{managerId:row.id},admin),/nghỉ việc/);
});
// Q-B-05: vị trí không khai báo phòng ban = vị trí liên chi nhánh (dùng ở mọi phòng ban).
test("vị trí liên chi nhánh dùng được ở mọi phòng ban, vị trí có phòng ban chỉ dùng đúng phòng ban",async () => {
  const deptA=await service.createDepartment({name:"IT",departmentCode:"IT"},admin);
  const deptB=await service.createDepartment({name:"Kế toán",departmentCode:"KT"},admin);
  const cross=await service.createPosition({name:"Trưởng ca",positionCode:"TRUONGCA"},admin);
  assert.equal(cross.isCrossBranch,true);
  const scoped=await service.createPosition({name:"Lập trình viên",positionCode:"DEV",departmentId:deptA.id},admin);
  assert.equal(scoped.isCrossBranch,false);
  const a=await service.createEmployee(employee({email:"a@company.test",departmentId:deptA.id,positionId:cross.id}),admin);
  const b=await service.createEmployee(employee({email:"b@company.test",departmentId:deptB.id,positionId:cross.id}),admin);
  assert.ok(a.id&&b.id);
  await assert.rejects(service.createEmployee(employee({email:"c@company.test",departmentId:deptB.id,positionId:scoped.id}),admin),/Vị trí/);
  const d=await service.createEmployee(employee({email:"d@company.test",departmentId:deptA.id,positionId:scoped.id}),admin);
  assert.ok(d.id);
  assert.equal((await service.listPositions({},admin)).find(row=>row.id===cross.id).isCrossBranch,true);
});
// Web cần số hồ sơ đang dùng một vị trí để cảnh báo trước khi xóa: xóa vị trí không
// chặn FK mà bỏ trống positionId của đúng số hồ sơ đó (onDelete: SetNull).
test("danh mục vị trí báo số hồ sơ đang dùng và xóa bỏ trống chức danh hồ sơ",async () => {
  const dept=await service.createDepartment({name:"Vận hành",departmentCode:"VH"},admin);
  const cross=await service.createPosition({name:"Điều phối",positionCode:"DK"},admin);
  const scoped=await service.createPosition({name:"Nhân viên vận hành",positionCode:"NVVH",departmentId:dept.id},admin);
  await service.createEmployee(employee({email:"e1@company.test",departmentId:dept.id,positionId:cross.id}),admin);
  const second=await service.createEmployee(employee({email:"e2@company.test",departmentId:dept.id,positionId:cross.id}),admin);
  const kept=await service.createEmployee(employee({email:"e3@company.test",departmentId:dept.id,positionId:scoped.id}),admin);
  const rows=await service.listPositions({},admin);
  assert.equal(rows.find(row=>row.id===cross.id).staff,2);
  assert.equal(rows.find(row=>row.id===scoped.id).staff,1);
  assert.equal((await service.getPosition(cross.id,admin)).staff,2);
  assert.equal((await service.updatePosition(scoped.id,{status:"tạm dừng"},admin)).staff,1);
  await service.removePosition(cross.id,admin);
  assert.equal((await service.getEmployee(second.id,admin)).positionId,null);
  assert.equal((await service.getEmployee(kept.id,admin)).positionId,scoped.id);
});