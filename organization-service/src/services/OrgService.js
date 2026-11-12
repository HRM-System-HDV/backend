"use strict";
const { randomUUID } = require("node:crypto");
const database = require("../config/database");
const identity = require("../clients/IdentityClient");
const { normalize, validateEmployeeRules, validateId, dateFields } = require("../validators/orgValidator");
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
    if (position.departmentId && position.departmentId !== row.departmentId) throw new ValidationError("Vị trí không thuộc phòng ban của nhân viên");
  }
  if (row.managerId) {
    const manager = await find("employee", row.managerId);
    if (kind === "branch" && (!row.id || manager.branchId !== row.id)) throw new ValidationError("Người quản lý phải thuộc chi nhánh này; tạo chi nhánh trước rồi gán người quản lý");
    if (kind === "department" && (!row.id || manager.departmentId !== row.id)) throw new ValidationError("Người phụ trách phải thuộc phòng ban này");
  }
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
async function createEmployee(payload, caller) {
  const data = access.assertEmployeeWrite(null,normalize("employee",payload),caller,true);
  if (data.salaryType === "hourly" && data.standardWorkDays === undefined) data.standardWorkDays = null;
  validateEmployeeRules(data); await verifyRelations("employee",data);
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
  validateEmployeeRules(candidate); await verifyRelations("employee",candidate); await validateEmployeeReferences(id,candidate);
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
  if (kind === "branch" && !caller.internal && caller.role !== "admin") result = result.filter(row => row.id === caller.branchId);
  return result;
}
async function getCatalog(kind,id,caller) {
  access.assertAuthenticated(caller);
  const row = await find(kind,id);
  if (kind === "branch" && !caller.internal && caller.role !== "admin" && row.id !== caller.branchId) throw new ForbiddenError("Không có quyền xem chi nhánh này");
  return row;
}
async function createCatalog(kind,payload,caller) {
  access.assertAdmin(caller); const data = normalize(kind,payload); await verifyRelations(kind,data); return insert(kind,data);
}
async function updateCatalog(kind,id,payload,caller) {
  access.assertAdmin(caller); const existing = await find(kind,id); const data = normalize(kind,payload,true);
  await verifyRelations(kind,{...existing,...data});
  if (kind === "position" && data.departmentId !== undefined && data.departmentId !== existing.departmentId) {
    const employees = await rows("employee",{positionId:id});
    if (employees.some(employee => data.departmentId && employee.departmentId !== data.departmentId)) throw new ValidationError("Vị trí đang được nhân viên ở phòng ban khác sử dụng");
  }
  return save(kind,id,data);
}
async function removeCatalog(kind,id,caller) {
  access.assertAdmin(caller); await find(kind,id);
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
const api = {listEmployees,getEmployee,createEmployee,updateEmployee,removeEmployee};
for (const [kind, title, plural] of [["branch","Branch","Branches"],["department","Department","Departments"],["position","Position","Positions"]]) {
  api[`list${plural}`] = (query,caller) => listCatalog(kind,query,caller);
  api[`get${title}`] = (id,caller) => getCatalog(kind,id,caller);
  api[`create${title}`] = (payload,caller) => createCatalog(kind,payload,caller);
  api[`update${title}`] = (id,payload,caller) => updateCatalog(kind,id,payload,caller);
  api[`remove${title}`] = (id,caller) => removeCatalog(kind,id,caller);
}
function resetForTests() { for (const kind of Object.keys(memory)) memory[kind].length = 0; branchSequence=0; employeeSequence=0; }
module.exports = {...api, resetForTests};
