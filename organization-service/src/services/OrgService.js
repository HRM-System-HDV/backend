"use strict";
const { randomUUID } = require("node:crypto");
const database = require("../config/database");
const identity = require("../clients/IdentityClient");
const { normalize, validateEmployeeRules, validateCccd, validateId, dateFields } = require("../validators/orgValidator");
const access = require("../utils/employeeAccess");
const { NotFoundError, DuplicateError, ValidationError, ForbiddenError } = require("../utils/errors");
const memory = {branch:[], department:[], position:[], employee:[]};
let branchSequence = 0, employeeSequence = 0;
function serialize(row) {
  if (!row) return row;
  const out = {...row};
  for (const key of dateFields) if (out[key] instanceof Date) out[key] = out[key].toISOString().slice(0,10);
  if (out.createdAt instanceof Date) out.createdAt = out.createdAt.toISOString();
  if (out.salary != null) out.salary = out.salary.toString();
  return out;
}
function prismaData(data) {
  const out = {...data};
  for (const key of dateFields) if (typeof out[key] === "string") out[key] = new Date(out[key] + "T00:00:00.000Z");
  return out;
}
function translate(error) {
  if (error.code === "P2002") throw new DuplicateError("Email hoặc mã nghiệp vụ đã tồn tại");
  if (error.code === "P2003") throw new ValidationError("Dữ liệu đang được tham chiếu hoặc tham chiếu không tồn tại");
  if (error.code === "P2025") throw new NotFoundError();
  throw error;
}
async function find(kind, id) {
  validateId(id);
  const prisma = database.getPrisma();
  const row = prisma ? await prisma[kind].findUnique({where:{id}}) : memory[kind].find(item => item.id === id);
  if (!row) throw new NotFoundError("Không tìm thấy dữ liệu");
  return serialize(row);
}
async function rows(kind, query = {}) {
  const where = {};
  const allowed = kind === "employee" ? ["id","email","branchId","departmentId","positionId","status"] : kind === "position" ? ["departmentId","status"] : ["status"];
  for (const key of allowed) if (query[key] !== undefined && query[key] !== "") {
    if (key.endsWith("Id") || key === "id") validateId(query[key]);
    where[key] = key === "email" ? String(query[key]).trim().toLowerCase() : query[key];
  }
  const prisma = database.getPrisma();
  const found = prisma ? await prisma[kind].findMany({where, orderBy:{createdAt:"asc"}}) : memory[kind].filter(item => Object.entries(where).every(([key,value]) => item[key] === value));
  return found.map(serialize);
}
async function verifyRelations(kind, row) {
  if (row.branchId) await find("branch", row.branchId);
  if (row.departmentId) await find("department", row.departmentId);
  if (row.positionId) {
    const position = await find("position", row.positionId);
    // Quy tắc vị trí (chốt): vị trí KHÔNG khai báo phòng ban là VỊ TRÍ LIÊN CHI NHÁNH
    // (dùng được ở mọi phòng ban); vị trí có phòng ban chỉ dùng được đúng phòng ban đó.
    if (position.departmentId && position.departmentId !== row.departmentId) {
      const department = await find("department", position.departmentId).catch(() => null);
      throw new ValidationError(`Vị trí «${position.name}» chỉ dùng cho phòng ban «${department ? department.name : position.departmentId}»; vị trí liên chi nhánh (không khai báo phòng ban) mới dùng được ở mọi phòng ban`);
    }
  }
  if (row.managerId) {
    const manager = await find("employee", row.managerId);
    if (manager.status === "nghỉ việc") throw new ValidationError("Không thể gán người quản lý/người phụ trách đang nghỉ việc");
    if (kind === "branch" && (!row.id || manager.branchId !== row.id)) throw new ValidationError("Người quản lý phải thuộc chi nhánh này; tạo chi nhánh trước rồi gán người quản lý");
    if (kind === "branch") {
      if (manager.status !== "đang làm") throw new ValidationError("Người quản lý phải là nhân viên đang làm việc");
      const accounts = await identity.getEmployeeRoles([manager.id]);
      if (!accounts.some(account => account.employeeId === manager.id && ["admin", "manager"].includes(account.systemRole))) throw new ValidationError("Người quản lý chi nhánh phải có vai trò Manager hoặc Admin");
    }
    if (kind === "department" && (!row.id || manager.departmentId !== row.id)) throw new ValidationError("Người phụ trách phải thuộc phòng ban này");
    if (kind === "department" && manager.status !== "đang làm") throw new ValidationError("Người phụ trách phải là nhân viên đang làm việc");
  }
}
// Vị trí không khai báo phòng ban = vị trí liên chi nhánh (dùng được ở mọi phòng ban).
// Cờ này nói rõ phạm vi vị trí cho phía gọi (Web/Mobile) thay vì phải tự suy ra từ departmentId.
// `staff` đếm MỌI hồ sơ trỏ tới vị trí (kể cả đã nghỉ việc) vì FK employees.positionId là
// onDelete: SetNull — xóa vị trí là bỏ trống chức danh của đúng số hồ sơ đó.
function positionView(row, employees) {
  return { ...row, isCrossBranch: !row.departmentId, staff: employees.filter(employee => employee.positionId === row.id).length };
}
function ensureUniqueMemory(kind, data, id) {
  const keys = kind === "employee" ? ["email", "employeeCode"] : kind === "branch" ? ["branchCode"] : kind === "department" ? ["departmentCode"] : ["positionCode"];
  for (const key of keys) if (data[key] && memory[kind].some(row => row.id !== id && row[key] === data[key])) throw new DuplicateError("Email hoặc mã nghiệp vụ đã tồn tại");
}
async function insert(kind, data) {
  const prisma = database.getPrisma();
  if (prisma) { try { return serialize(await prisma[kind].create({data:prismaData(data)})); } catch (error) { translate(error); } }
  const defaults = kind === "employee" ? {employeeCode:`NV-${String(++employeeSequence).padStart(5,"0")}`,status:"đang làm", branchId:null,departmentId:null,positionId:null,standardWorkDays:null,resignedAt:null} : {status:"hoạt động"};
  if (kind === "branch") defaults.branchCode = `CN-${String(++branchSequence).padStart(5,"0")}`;
  const row = {id:randomUUID(),createdAt:new Date().toISOString(),...defaults,...data};
  ensureUniqueMemory(kind,row);
  memory[kind].push(row); return {...row};
}
async function save(kind, id, data) {
  const prisma = database.getPrisma();
  if (prisma) { try { return serialize(await prisma[kind].update({where:{id},data:prismaData(data)})); } catch (error) { translate(error); } }
  const row = memory[kind].find(item => item.id === id);
  if (!row) throw new NotFoundError();
  ensureUniqueMemory(kind,data,id); Object.assign(row,data); return {...row};
}
async function syncEmployee(row, action = "upsert") {
  await identity.syncEmployeeToIdentity(row, action);
  return row;
}
async function listEmployees(query, caller) { return rows("employee", access.employeeScope(query || {}, caller)); }
async function getEmployee(id, caller) { const row = await find("employee",id); access.assertEmployeeRead(row,caller); return row; }
// Các trường hồ sơ CCCD — chỉ kiểm tra khi thao tác có đụng tới chúng, để hồ sơ cũ
// (chỉ có số CCCD, chưa có ngày/nơi cấp) không bị chặn khi cập nhật trường khác.
const CCCD_FIELDS = ["cccd","issueDate","issuePlace","cccdFront","cccdBack"];
async function createEmployee(payload, caller) {
  const data = access.assertEmployeeWrite(null,normalize("employee",payload),caller,true);
  if (data.salaryType === "hourly" && data.standardWorkDays === undefined) data.standardWorkDays = null;
  validateEmployeeRules(data); validateCccd(data); await verifyRelations("employee",data);
  return syncEmployee(await insert("employee",data));
}
async function validateEmployeeReferences(id, row) {
  const prisma = database.getPrisma();
  const branches = prisma ? await prisma.branch.findMany({where:{managerId:id}}) : memory.branch.filter(item => item.managerId === id);
  const departments = prisma ? await prisma.department.findMany({where:{managerId:id}}) : memory.department.filter(item => item.managerId === id);
  if (branches.some(item => item.id !== row.branchId) || departments.some(item => item.id !== row.departmentId)) throw new ValidationError("Cần thay người phụ trách trước khi chuyển phòng ban hoặc chi nhánh");
}
async function updateEmployee(id,payload,caller) {
  const existing = await find("employee",id);
  const data = access.assertEmployeeWrite(existing,normalize("employee",payload,true),caller);
  const candidate = {...existing,...data};
  validateEmployeeRules(candidate);
  if (CCCD_FIELDS.some(key => data[key] !== undefined)) validateCccd(candidate);
  await verifyRelations("employee",candidate); await validateEmployeeReferences(id,candidate);
  return syncEmployee(await save("employee",id,data));
}
async function removeEmployee(id,caller, resignedAt = new Date().toISOString().slice(0,10)) {
  access.assertManager(caller);
  const existing = await find("employee",id);
  access.assertEmployeeWrite(existing,{},caller);
  const data = normalize("employee",{status:"nghỉ việc",resignedAt},true);
  validateEmployeeRules({...existing,...data});
  return syncEmployee(await save("employee",id,data),"resign");
}
async function listCatalog(kind,query,caller) {
  access.assertAuthenticated(caller);
  let result = await rows(kind,query);
  if (kind === "branch" && !caller.internal && !["admin", "manager"].includes(caller.role)) result = result.filter(row => row.id === caller.branchId);
  if (kind === "branch") {
    const employees = await rows("employee");
    result = result.map(row => branchView(row, employees));
  }
  if (kind === "position") {
    const employees = await rows("employee");
    result = result.map(row => positionView(row, employees));
  }
  if (kind === "department") {
    const employees = await rows("employee");
    result = result.map(row => departmentView(row, employees));
  }
  return result;
}
async function getCatalog(kind,id,caller) {
  access.assertAuthenticated(caller);
  const row = await find(kind,id);
  if (kind === "branch" && !caller.internal && !["admin", "manager"].includes(caller.role) && row.id !== caller.branchId) throw new ForbiddenError("Không có quyền xem chi nhánh này");
  if (kind === "branch") return branchView(row, await rows("employee", { branchId: row.id }));
  if (kind === "department") return departmentView(row, await rows("employee", { departmentId: row.id }));
  if (kind === "position") return positionView(row, await rows("employee", { positionId: row.id }));
  return row;
}
async function createCatalog(kind,payload,caller) {
  if (kind === "branch") assertBranchWrite(null, caller); else if (kind === "department") access.assertManager(caller); else access.assertAdmin(caller);
  const data = normalize(kind,payload); await verifyRelations(kind,data);
  const row = await insert(kind,data);
  return kind === "branch" ? branchView(row, []) : kind === "department" ? departmentView(row, []) : kind === "position" ? positionView(row, []) : row;
}
async function updateCatalog(kind,id,payload,caller) {
  if (kind === "branch") assertBranchWrite(id, caller); else if (kind === "department") access.assertManager(caller); else access.assertAdmin(caller);
  const existing = await find(kind,id); const data = normalize(kind,payload,true);
  await verifyRelations(kind,{...existing,...data});
  if (kind === "position" && data.departmentId !== undefined && data.departmentId !== existing.departmentId) {
    const employees = await rows("employee",{positionId:id});
    if (employees.some(employee => data.departmentId && employee.departmentId !== data.departmentId)) throw new ValidationError("Vị trí đang được nhân viên ở phòng ban khác sử dụng");
  }
  const row = await save(kind,id,data);
  if (kind === "department") return departmentView(row, await rows("employee", { departmentId: id }));
  return kind === "branch" ? branchView(row, await rows("employee", { branchId: id })) : kind === "position" ? positionView(row, await rows("employee", { positionId: id })) : row;
}
async function removeCatalog(kind,id,caller) {
  if (kind === "branch") assertBranchWrite(id, caller); else if (kind === "department") access.assertManager(caller); else access.assertAdmin(caller);
  await find(kind,id);
  const branchEmployees = kind === "branch" ? await rows("employee",{branchId:id}) : [];
  const prisma = database.getPrisma();
  if (prisma) { try { await prisma[kind].delete({where:{id}}); } catch (error) { translate(error); } }
  else {
    memory[kind].splice(memory[kind].findIndex(row => row.id === id),1);
    const foreignKey = `${kind}Id`;
    for (const row of memory.employee) if (row[foreignKey] === id) row[foreignKey] = null;
    if (kind === "department") for (const row of memory.position) if (row.departmentId === id) row.departmentId = null;
  }
  for (const employee of branchEmployees) await syncEmployee({...employee,branchId:null});
  return {ok:true};
}
function departmentView(row, employees) {
  return { ...row, managerId: row.managerId || null,
    manager: employees.find(employee => employee.id === row.managerId)?.name || "",
    // Cùng nghĩa với cột "Nhân sự" của branchView: chỉ đếm hồ sơ đang làm.
    staff: employees.filter(employee => employee.departmentId === row.id && employee.status === "đang làm").length };
}
async function listDepartmentManagerCandidates(id, caller) {
  access.assertManager(caller);
  await find("department", id);
  return (await rows("employee", { departmentId: id, status: "đang làm" }))
    .map(employee => ({ id: employee.id, name: employee.name }));
}
function branchView(row, employees) {
  return { ...row, address: row.address || "", managerId: row.managerId || null,
    manager: employees.find(employee => employee.id === row.managerId)?.name || "",
    staff: employees.filter(employee => employee.branchId === row.id && employee.status === "đang làm").length };
}
function assertBranchWrite(id, caller) {
  access.assertManager(caller);
  if (id && caller.role === "manager" && (!caller.branchId || caller.branchId !== id)) throw new ForbiddenError("Quản lý chỉ được sửa hoặc xóa chi nhánh của mình");
}
async function listBranchManagerCandidates(id, caller) {
  assertBranchWrite(id, caller);
  await find("branch", id);
  const employees = await rows("employee", { branchId: id, status: "đang làm" });
  const accounts = new Map((await identity.getEmployeeRoles(employees.map(employee => employee.id))).map(account => [account.employeeId, account.systemRole]));
  return employees.filter(employee => ["admin", "manager"].includes(accounts.get(employee.id)))
    .map(employee => ({ id: employee.id, name: employee.name, systemRole: accounts.get(employee.id) }));
}
const api = {listEmployees,getEmployee,createEmployee,updateEmployee,removeEmployee,listBranchManagerCandidates,listDepartmentManagerCandidates};
for (const [kind, title, plural] of [["branch","Branch","Branches"],["department","Department","Departments"],["position","Position","Positions"]]) {
  api[`list${plural}`] = (query,caller) => listCatalog(kind,query,caller);
  api[`get${title}`] = (id,caller) => getCatalog(kind,id,caller);
  api[`create${title}`] = (payload,caller) => createCatalog(kind,payload,caller);
  api[`update${title}`] = (id,payload,caller) => updateCatalog(kind,id,payload,caller);
  api[`remove${title}`] = (id,caller) => removeCatalog(kind,id,caller);
}
function resetForTests() { for (const kind of Object.keys(memory)) memory[kind].length = 0; branchSequence=0; employeeSequence=0; }
module.exports = {...api, resetForTests};
