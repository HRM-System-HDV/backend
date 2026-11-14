"use strict";
const {randomUUID} = require("node:crypto");
const database = require("../config/database");
const clients = require("../clients/ServiceClient");
const {admin, manager, branch, uuid, error} = require("../utils/access");
const {matchesWhere} = require("../utils/where");
const memory = Object.fromEntries(["request","notification","notificationSetting","news","regulation","wifiConfig","backlog","soapGatewayConfig"].map(key => [key, []]));
const types = ["leave","advance","shift_swap","work_supplement"];
const statuses = ["pending","approved","rejected"];
const dateFields = ["leaveStartDate","leaveEndDate","publishDate","effectiveDate","expiryDate"];
const instantFields = ["requestedCheckIn","requestedCheckOut","reviewedAt","lastPingTime","certExpiry"];
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw error(`Thiếu ${label}`); return value.trim(); }
function pick(body, fields) { const out = {}; for (const [key,value] of Object.entries(body || {})) { if (!fields.includes(key)) throw error(`Trường không được hỗ trợ: ${key}`); out[key] = value; } return out; }
function dates(data) {
  const out = {...data};
  for (const key of dateFields) if (out[key] != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out[key]) || !Number.isFinite(Date.parse(`${out[key]}T00:00:00Z`)) || new Date(out[key]).toISOString().slice(0,10) !== out[key]) throw error(`${key} phải là ngày ISO hợp lệ`);
    out[key] = new Date(`${out[key]}T00:00:00Z`);
  }
  for (const key of instantFields) if (out[key] != null) { if (!/(Z|[+-]\d{2}:\d{2})$/.test(out[key]) || !Number.isFinite(Date.parse(out[key]))) throw error(`${key} phải có múi giờ`); out[key] = new Date(out[key]); }
  return out;
}
function serialize(row) {
  const out = {...row};
  for (const [key,value] of Object.entries(out)) if (value instanceof Date) out[key] = dateFields.includes(key) ? value.toISOString().slice(0,10) : value.toISOString();
  if (out.advanceAmount != null) out.advanceAmount = out.advanceAmount.toString();
  return out;
}
async function all(kind, where = {}) { const db = database.getPrisma(); return (db ? await db[kind].findMany({where}) : memory[kind].filter(row => matchesWhere(row, where))).map(serialize); }
async function get(kind,id) { uuid(id); const db=database.getPrisma(); const row=db ? await db[kind].findUnique({where:{id}}) : memory[kind].find(row=>row.id===id); if (!row) throw error("Không tìm thấy dữ liệu",404,"NOT_FOUND"); return serialize(row); }
async function add(kind,data) { const db=database.getPrisma(); const prepared=dates(data); if (db) return serialize(await db[kind].create({data:prepared})); const row={id:randomUUID(),createdAt:new Date().toISOString(),...serialize(prepared)}; memory[kind].push(row); return {...row}; }
async function save(kind,id,data) { const db=database.getPrisma(); const prepared=dates(data); if (db) return serialize(await db[kind].update({where:{id},data:prepared})); const row=memory[kind].find(row=>row.id===id); if (!row) throw error("Không tìm thấy dữ liệu",404,"NOT_FOUND"); Object.assign(row,serialize(prepared)); return {...row}; }
async function remove(kind,id) { await get(kind,id); const db=database.getPrisma(); if (db) await db[kind].delete({where:{id}}); else {memory[kind].splice(memory[kind].findIndex(row=>row.id===id),1);if(kind==="request")for(const row of memory.notification)if(row.requestId===id)row.requestId=null;} return {deleted:true}; }
function scope(who, value, write=false) { if (write && who.role !== "admin") {if(value !== undefined && value !== who.branchId) throw error("Không được ghi ngoài chi nhánh của mình",403,"FORBIDDEN");return (branch(who,who.branchId,true),who.branchId);} if (value != null) uuid(value,"branchId"); branch(who,value,write); return value || null; }
function requestRead(row,who) { if (who.role === "admin") return; if (who.role === "manager" && (!who.branchId || row.branchId !== who.branchId)) throw error("Đơn không thuộc chi nhánh được quản lý",403,"FORBIDDEN"); branch(who,row.branchId); if (who.role === "staff" && ![row.employeeId,row.targetEmployeeId].includes(who.employeeId)) throw error("Không được xem đơn người khác",403,"FORBIDDEN"); }
// —— Phạm vi dữ liệu: dựng điều kiện WHERE cho Prisma ——
// BUSINESS.md §9.3: phạm vi chi nhánh phải được BE áp dụng khi trả dữ liệu,
// không lọc bằng JavaScript ở tầng ứng dụng.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) { return UUID_PATTERN.test(String(value || "")); }
function branchScopeCondition(field, branchId) { return { OR: [ { [field]: null }, { [field]: branchId ?? null } ] }; }
// Phạm vi đọc của mẫu đơn, ánh xạ đúng logic requestRead() ở trên.
function requestScopeWhere(who) {
  if (who.role === "admin") return null;
  if (who.role === "manager") return { branchId: who.branchId };
  if (who.role === "staff") {
    const owner = { OR: [ { employeeId: who.employeeId }, { targetEmployeeId: who.employeeId } ] };
    if (who.internal) return owner;
    return { AND: [ branchScopeCondition("branchId", who.branchId), owner ] };
  }
  return null;
}
// Phạm vi đọc của nội dung nội bộ (bảng tin/quy định/Wi-Fi).
function contentScopeConditions(kind, field, query, who) {
  const conditions = [];
  if (kind === "wifiConfig") {
    // Lệnh nội bộ chỉ đọc cấu hình đang hoạt động; admin đọc được toàn bộ.
    if (who.internal) conditions.push({ status: "hoạt động" });
  } else if (who.role !== "admin") {
    conditions.push(branchScopeCondition(field, who.branchId));
  }
  if (query.branchId) conditions.push(kind === "wifiConfig" ? { [field]: query.branchId } : { OR: [ { [field]: query.branchId }, { [field]: null } ] });
  return conditions;
}
function toWhere(conditions) { return conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : { AND: conditions }; }
function shiftDay(shift) { return shift.workDate instanceof Date ? shift.workDate.toISOString().slice(0,10) : String(shift.workDate || "").slice(0,10); }
function shiftTimes(shift) { const day=shiftDay(shift); const start=Date.parse(`${day}T${shift.scheduledStart}:00+07:00`); let end=Date.parse(`${day}T${shift.scheduledEnd}:00+07:00`); if (!Number.isFinite(start) || !Number.isFinite(end)) throw error("Không đọc được thời gian của ca, không thể kiểm tra điều kiện đổi ca",422,"VALIDATION_ERROR"); if (end<=start) end+=86400000; return [start,end]; }
// Trạng thái chấm công của ca: true = đã chấm công, false = chưa chấm công,
// null = KHÔNG xác định được (service khác chưa trả kèm attendance).
function checkedInState(shift) {
  if (!shift) return null;
  if (Object.prototype.hasOwnProperty.call(shift,"attendance") && shift.attendance !== undefined) return !!shift.attendance?.checkIn;
  if (typeof shift.attendanceState === "string") {
    if (["working","completed","missed_checkout"].includes(shift.attendanceState)) return true;
    if (["not_started","missed_checkin"].includes(shift.attendanceState)) return false;
  }
  return null;
}
// Không phụ thuộc mùa vào việc service khác có trả `attendance` hay không:
// nếu thiếu thì hỏi lại qua GET /api/shifts?employeeId= (đã có attendance),
// vẫn không xác định được thì chặn (fail-closed) thay vì coi như "chưa chấm công".
async function resolveCheckedIn(shift,label) {
  let state = checkedInState(shift);
  if (state === null && shift && shift.employeeId) {
    try {
      const list = await clients.shifts({employeeId: shift.employeeId});
      const found = (list || []).find(item => item && item.id === shift.id);
      if (found) state = checkedInState(found);
    } catch { state = null; }
  }
  if (state === null) throw error(`Không xác định được trạng thái chấm công của ${label} nên không thể kiểm tra điều kiện đổi ca. Vui lòng thử lại sau.`,409,"CONFLICT");
  return state;
}
async function validateSwap(data) {
  const source=await clients.shift(uuid(data.sourceShiftId,"sourceShiftId"));
  if (source.employeeId !== data.employeeId) throw error("Ca nguồn không thuộc người gửi đơn");
  const sourceTime=shiftTimes(source);
  if (sourceTime[0]<=Date.now() || source.status === "đã hủy") throw error("Chỉ đề nghị đổi ca chưa tới giờ và chưa chấm công");
  if (await resolveCheckedIn(source,"ca nguồn")) throw error("Chỉ đề nghị đổi ca chưa tới giờ và chưa chấm công");
  if (data.targetEmployeeId === data.employeeId) throw error("Không được nhờ chính mình");
  const targetEmployee=await clients.employee(uuid(data.targetEmployeeId,"targetEmployeeId"));
  if (targetEmployee.branchId !== data.branchId || targetEmployee.status === "nghỉ việc") throw error("Nhân viên đích không thuộc phạm vi làm việc hợp lệ");
  if (data.targetShiftId) {
    const target=await clients.shift(uuid(data.targetShiftId,"targetShiftId"));
    if (target.employeeId !== data.targetEmployeeId || shiftTimes(target)[0]<=Date.now()) throw error("Ca đích không hợp lệ hoặc đã bắt đầu");
    if (await resolveCheckedIn(target,"ca đích")) throw error("Ca đích không hợp lệ hoặc đã bắt đầu");
  }
  const shifts=await clients.shifts({employeeId:data.targetEmployeeId});
  for (const other of shifts) {
    if (other.status === "đã hủy") continue;
    const [start,end]=shiftTimes(other);
    if (shiftDay(other)===shiftDay(source) && other.templateId===source.templateId || start<sourceTime[1] && sourceTime[0]<end) throw error("Nhân viên đích đã có ca này hoặc ca chồng giờ",409,"DUPLICATE_RESOURCE");
  }
}
// Danh sách tối thiểu để chọn người nhận ca, không mở quyền đọc hồ sơ/lịch sử công.
async function shiftOptions(query, who) {
  const source = await clients.shift(uuid(query.sourceShiftId, "sourceShiftId"));
  const owner = await clients.employee(source.employeeId);
  uuid(owner.branchId, "branchId");
  branch(who, owner.branchId, true);
  if (who.role === "staff" && source.employeeId !== who.employeeId) throw error("Ca không thuộc nhân viên", 403, "FORBIDDEN");
  if (source.status === "đã hủy" || shiftTimes(source)[0] <= Date.now() || await resolveCheckedIn(source, "ca nguồn")) throw error("Chỉ đề nghị đổi ca chưa tới giờ và chưa chấm công");
  const employees = (await clients.employees({branchId: owner.branchId}))
    .filter(row => row.branchId === owner.branchId && row.status !== "nghỉ việc" && row.id !== source.employeeId);
  const ids = new Set(employees.map(row => row.id));
  const shifts = (await clients.shifts({branchId: owner.branchId}))
    .filter(row => ids.has(row.employeeId) && row.status !== "đã hủy" && shiftTimes(row)[0] > Date.now() && checkedInState(row) === false)
    .map(({id, employeeId, workDate, templateId, scheduledStart, scheduledEnd, status}) => ({id, employeeId, workDate, templateId, scheduledStart, scheduledEnd, status}));
  return {employees: employees.map(({id, name}) => ({id, name})), shifts};
}
async function listRequests(query,who) {
  // Quản lý không có chi nhánh thì không được xem đơn nào (trước đây mọi dòng đều bị loại).
  if (who.role === "manager" && !who.branchId) return [];
  // Nhân viên chưa gắn hồ sơ nhân sự thì không xem được đơn nào.
  if (who.role === "staff" && !who.employeeId) return [];
  if (query.employeeId && !isUuid(query.employeeId)) return [];
  if (query.status && !statuses.includes(query.status)) return [];
  if (query.type && !types.includes(query.type)) return [];
  const conditions = [];
  const scope = requestScopeWhere(who);
  if (scope) conditions.push(scope);
  for (const key of ["employeeId","status","type"]) if (query[key]) conditions.push({ [key]: query[key] });
  return all("request", toWhere(conditions));
}
async function createRequest(body,who) {
  const data=pick(body,["type","employeeId","targetEmployeeId","branchId","title","content","attachmentUrl","leaveStartDate","leaveEndDate","advanceAmount","sourceShiftId","targetShiftId","requestedCheckIn","requestedCheckOut"]);
  if (!types.includes(data.type)) throw error("Loại đơn không hợp lệ");
  const specific={leave:["leaveStartDate","leaveEndDate"],advance:["advanceAmount"],shift_swap:["sourceShiftId","targetShiftId","targetEmployeeId"],work_supplement:["sourceShiftId","requestedCheckIn","requestedCheckOut"]};
  const optional=new Set(Object.values(specific).flat());for(const key of optional)if(data[key]!=null && !specific[data.type].includes(key))throw error(`Trường ${key} không thuộc loại đơn này`);
  data.employeeId=who.role === "staff" ? who.employeeId : data.employeeId || who.employeeId; uuid(data.employeeId,"employeeId");
  const employee=await clients.employee(data.employeeId); branch(who,employee.branchId,true); data.branchId=employee.branchId;
  data.title=text(data.title,"tiêu đề"); data.content=text(data.content,"nội dung"); dates(data);
  if (data.type === "leave" && (!data.leaveStartDate || !data.leaveEndDate || data.leaveEndDate<data.leaveStartDate)) throw error("Khoảng ngày nghỉ không hợp lệ");
  if (data.type === "advance" && (!/^\d{1,15}$/.test(String(data.advanceAmount)) || BigInt(data.advanceAmount)<=0n)) throw error("Số tiền ứng phải là số nguyên dương tối đa 15 chữ số");
  if (data.type === "work_supplement") { uuid(data.sourceShiftId,"sourceShiftId"); if (!data.requestedCheckIn && !data.requestedCheckOut || data.requestedCheckIn && data.requestedCheckOut && Date.parse(data.requestedCheckOut)<Date.parse(data.requestedCheckIn)) throw error("Giờ đề nghị không hợp lệ"); const shift=await clients.shift(data.sourceShiftId); if (shift.employeeId!==data.employeeId) throw error("Ca không thuộc nhân viên"); }
  if (data.type === "shift_swap") { await validateSwap(data); data.shiftSwapMode=(await clients.attendanceConfig(data.branchId)).shiftSwapMode; }
  const row=await add("request",{...data,status:"pending"});
  if (row.targetEmployeeId) await sendNotification({targetEmployeeId:row.targetEmployeeId,branchId:row.branchId,title:row.title,body:row.content,requestId:row.id,requestType:row.type},who,true).catch(e=>console.warn("Không gửi được thông báo đơn:",e.message));
  return row;
}
async function reviewRequest(id,approved,body,who,peer=false) {
  const row=await get("request",id); requestRead(row,who);
  if (row.status!=="pending") throw error("Đơn đã được xử lý");
  if (peer) { if (row.type!=="shift_swap" || row.shiftSwapMode!=="mutual_acceptance" || row.targetEmployeeId!==who.employeeId) throw error("Bạn không có quyền phản hồi đơn này",403,"FORBIDDEN"); }
  else { manager(who); branch(who,row.branchId,true); if (row.type==="shift_swap" && row.shiftSwapMode==="mutual_acceptance" && who.role!=="admin") throw error("Đơn này do nhân viên đích phản hồi",403,"FORBIDDEN"); }
  // Đơn đổi ca KHÁC ba loại đơn còn lại: duyệt/chấp nhận là lệnh đổi lịch phân ca thật.
  // Work phải đổi trước; nếu Work từ chối thì đơn vẫn còn pending và người dùng thấy lỗi.
  if (approved && row.type==="shift_swap") { await validateSwap(row); await clients.swapShifts({sourceShiftId:row.sourceShiftId,targetShiftId:row.targetShiftId||null,targetEmployeeId:row.targetEmployeeId},who); }
  const data={status:approved?"approved":"rejected",reviewedBy:uuid(who.userId,"userId"),reviewedByName:who.name,reviewedAt:new Date().toISOString(),reviewNote:body.reviewNote || null};
  // Ngoài đổi ca, chỉ cập nhật mẫu đơn; tuyệt đối không gọi API ghi chấm công/lương/thanh toán.
  const db=database.getPrisma();let updated;
  if(db){const result=await db.request.updateMany({where:{id,status:"pending"},data:dates(data)});if(result.count!==1)throw error("Đơn đã được xử lý",409,"DUPLICATE_RESOURCE");updated=await get("request",id);}
  else {const live=memory.request.find(item=>item.id===id);if(live.status!=="pending")throw error("Đơn đã được xử lý",409,"DUPLICATE_RESOURCE");Object.assign(live,data);updated={...live};}
  await sendNotification({targetEmployeeId:row.employeeId,branchId:row.branchId,title:"Kết quả đơn đề nghị",body:`${row.title}: ${approved?"Đã chấp thuận":"Đã từ chối"}`,requestId:id,requestType:row.type},who,true).catch(e=>console.warn("Không gửi được kết quả đơn:",e.message));
  return updated;
}
async function deleteRequest(id,who) {
  const row=await get("request",id); requestRead(row,who); manager(who); branch(who,row.branchId,true);
  if(row.status!=="pending") throw error("Chỉ xóa đơn đang chờ");
  const db=database.getPrisma();
  if(db) {
    const result=await db.request.deleteMany({where:{id,status:"pending"}});
    if(result.count!==1) throw error("Đơn đã được xử lý hoặc đã xóa. Vui lòng tải lại.",409,"CONFLICT");
  } else {
    const index=memory.request.findIndex(item=>item.id===id && item.status==="pending");
    if(index<0) throw error("Đơn đã được xử lý hoặc đã xóa. Vui lòng tải lại.",409,"CONFLICT");
    memory.request.splice(index,1);
    for(const notification of memory.notification) if(notification.requestId===id) notification.requestId=null;
  }
  return {deleted:true};
}
// Mức cô lập Serializable cho ghi fanout (Prisma enum = chuỗi "Serializable").
function serializableIsolation() { try { return require("@prisma/client").Prisma.TransactionIsolationLevel.Serializable; } catch { return "Serializable"; } }
// Ghi fanout thông báo: mỗi người nhận một dòng (BUSINESS.md §9.2) nhưng phải ghi
// NGUYÊN TẬM — lỗi giữa chừng không được để lại danh sách người nhận dở dang.
async function createNotifications(items) {
  if (!items.length) return [];
  const db = database.getPrisma();
  if (db) {
    const rows = await db.$transaction(async (tx) => {
      const created = [];
      for (const item of items) created.push(await tx.notification.create({ data: dates(item) }));
      return created;
    }, { isolationLevel: serializableIsolation(), maxWait: 5000, timeout: 15000 });
    return rows.map(serialize);
  }
  // Kho in-memory: ghi tạm rồi mới commit, lỗi thì rollback về trạng thái cũ.
  const snapshot = memory.notification.length;
  try {
    return items.map(item => {
      const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...serialize(dates(item)) };
      memory.notification.push(row);
      return { ...row };
    });
  } catch (e) { memory.notification.length = snapshot; throw e; }
}
async function sendNotification(body,who,system=false) {
  if (!system) manager(who);
  const data=pick(body,["targetEmployeeId","branchId","title","body","metadata","requestId","requestType"]);
  data.title=text(data.title,"tiêu đề"); data.body=text(data.body,"nội dung"); data.branchId=scope(who,data.branchId,!system);
  if (data.requestId) { const request=await get("request",data.requestId); data.requestType=request.type; }
  const employees=data.targetEmployeeId ? [await clients.employee(uuid(data.targetEmployeeId,"targetEmployeeId"))] : await clients.employees(data.branchId?{branchId:data.branchId}:{});
  const items=[];
  for(const employee of employees) {
    if (data.branchId && employee.branchId!==data.branchId) throw error("Người nhận ngoài phạm vi thông báo",403,"FORBIDDEN");
    items.push({...data,targetEmployeeId:employee.id,isRead:false,senderId:who.userId,senderName:who.name});
  }
  const rows=await createNotifications(items);
  return rows.length===1 ? rows[0] : rows;
}
async function listNotifications(who) { if(!who.employeeId) return []; return all("notification",{targetEmployeeId:who.employeeId}); }
async function readNotification(id,who) { const row=await get("notification",id); if(row.targetEmployeeId!==who.employeeId) throw error("Không được sửa thông báo người khác",403,"FORBIDDEN"); return save("notification",id,{isRead:true}); }
async function readAllNotifications(who) {
  if (!who.employeeId) return { count: 0 };
  const targetEmployeeId = uuid(who.employeeId, "employeeId");
  const db = database.getPrisma();
  if (db) return db.notification.updateMany({ where: { targetEmployeeId, isRead: false }, data: { isRead: true } });
  let count = 0;
  for (const row of memory.notification) {
    if (row.targetEmployeeId === targetEmployeeId && !row.isRead) { row.isRead = true; count++; }
  }
  return { count };
}
const settingFields=["checkInBefore1Hour","checkInBefore30Min","checkInBefore10Min","checkOutBefore10Min","missedCheckOutAfter10Min","missedCheckOutAfter30Min","missedCheckOutAfter1Hour","tabNotificationAlert","soundEnabled","vibrateEnabled"];
async function notificationSettings(who,body) {
  uuid(who.userId,"userId"); const data=body ? pick(body,settingFields) : {};
  for(const value of Object.values(data)) if(typeof value!=="boolean") throw error("Cài đặt phải là boolean");
  const defaults=Object.fromEntries(settingFields.map(key=>[key,true])); const db=database.getPrisma();
  if(db) return db.notificationSetting.upsert({where:{userId:who.userId},create:{userId:who.userId,...defaults,...data},update:data});
  let row=memory.notificationSetting.find(row=>row.userId===who.userId); if(!row) {row={userId:who.userId,...defaults};memory.notificationSetting.push(row);} Object.assign(row,data); return {...row};
}
async function reminders(who,now=new Date()) {
  if(!who.employeeId) return [];
  const settings=await notificationSettings(who); const shifts=await clients.shifts({employeeId:who.employeeId}); const current=await listNotifications(who); const added=[];
  const rules=[["checkInBefore1Hour",-60,"in"],["checkInBefore30Min",-30,"in"],["checkInBefore10Min",-10,"in"],["checkOutBefore10Min",-10,"out"],["missedCheckOutAfter10Min",10,"out"],["missedCheckOutAfter30Min",30,"out"],["missedCheckOutAfter1Hour",60,"out"]];
  for(const shift of shifts) { if(shift.status==="đã hủy") continue; const [start,end]=shiftTimes(shift);
    // Không xác định được trạng thái chấm công thì không gửi nhắc (tránh nhắc sai).
    if (checkedInState(shift) === null) continue;
    for(const [key,minutes,side] of rules) { if(!settings[key] || side==="in" && shift.attendance?.checkIn || side==="out" && (!shift.attendance?.checkIn || shift.attendance?.checkOut)) continue;
      const due=(side==="in"?start:end)+minutes*60000; if(now.getTime()<due || now.getTime()>=due+60000) continue;
      const reminderKey=`${shift.id}:${key}`; if(current.some(row=>row.metadata?.reminderKey===reminderKey)) continue;
      added.push(await add("notification",{targetEmployeeId:who.employeeId,branchId:who.branchId,title:"Nhắc chấm công",body:side==="in"?"Sắp đến giờ vào ca":"Vui lòng kiểm tra giờ ra ca",isRead:false,metadata:{reminderKey,shiftId:shift.id},senderId:null,senderName:null}));
    }
  } return added;
}
const contentFields={news:["title","summary","content","publishDate","tag","pinned","branchId"],regulation:["regulationCode","title","category","summary","content","status","scopeBranchId","effectiveDate","expiryDate","version","pinned"],wifiConfig:["ssid","bssid","branchId","status"]};
async function contentList(kind,query,who) {
  if(kind==="wifiConfig" && !who.internal) admin(who);
  const field=kind==="regulation"?"scopeBranchId":"branchId";
  // branchId sai định dạng UUID thì không có dòng nào khớp — trả rỗng, không lỗi.
  if(query.branchId && !isUuid(query.branchId)) return [];
  return all(kind, toWhere(contentScopeConditions(kind,field,query,who)));
}
async function contentWrite(kind,id,body,who) {
  if(kind==="wifiConfig") admin(who); else manager(who);
  const data=pick(body,contentFields[kind]); const field=kind==="regulation"?"scopeBranchId":"branchId"; const existing=id ? await get(kind,id) : null;
  if(existing) branch(who,existing[field],true);
  data[field]=scope(who,data[field]===undefined?existing?.[field]:data[field],true);
  const row={...existing,...data};
  const required=kind==="news"?["title","summary","content","publishDate","tag"]:kind==="regulation"?["regulationCode","title","category","summary","content","effectiveDate"]:["ssid","bssid"];
  for(const key of required) text(row[key],key);
  if(kind==="wifiConfig") { uuid(row.branchId,"branchId"); if(!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(row.bssid)) throw error("BSSID không hợp lệ"); data.bssid=row.bssid.toLowerCase(); }
  if(kind==="wifiConfig" && row.status!==undefined && !["hoạt động","vô hiệu hóa"].includes(row.status))throw error("Trạng thái Wi-Fi không hợp lệ");
  if(kind==="regulation" && row.status!==undefined && !["hiệu lực","dự thảo","hết hiệu lực"].includes(row.status))throw error("Trạng thái quy định không hợp lệ");
  if(row.expiryDate && row.expiryDate<row.effectiveDate) throw error("Ngày hết hiệu lực trước ngày hiệu lực");
  if(data.pinned!==undefined && typeof data.pinned!=="boolean") throw error("pinned phải là boolean");
  if(kind==="regulation" && (await all(kind)).some(item=>item.regulationCode===row.regulationCode && item.id!==id)) throw error("Mã quy định đã tồn tại",409,"DUPLICATE_RESOURCE");
  if(id) return save(kind,id,data);
  return add(kind,{...(kind==="news"?{pinned:false,authorId:who.userId,authorName:who.name}:kind==="regulation"?{status:"hiệu lực",version:"1.0",pinned:false}:{status:"hoạt động"}),...data});
}
async function contentGet(kind,id,who) { const row=await get(kind,id); const list=await contentList(kind,{},who); if(!list.some(item=>item.id===id)) throw error("Ngoài phạm vi dữ liệu",403,"FORBIDDEN"); if(kind==="regulation") row.files=await require("./FileService").findForRegulation(id); return row; }
async function contentDelete(kind,id,who) { if(kind==="wifiConfig") admin(who); else manager(who); const row=await get(kind,id); branch(who,row[kind==="regulation"?"scopeBranchId":"branchId"],true); return remove(kind,id); }
async function backlog(body,who) { if(!who.internal) throw error("Nhật ký chỉ ghi qua nghiệp vụ nội bộ",403,"FORBIDDEN"); const data=pick(body,["userId","userName","userRole","action","module","entityType","entityId","targetName"]); for(const key of ["userName","action","module","entityType","entityId","targetName"]) text(data[key],key); if(data.userId) uuid(data.userId); return add("backlog",data); }
async function listBacklog(who) { admin(who); return all("backlog"); }
async function soapConfig(who,body) {
  admin(who); const rows=await all("soapGatewayConfig",{isSingleton:true}); let row=rows[0] || null;
  if(body===undefined) return row;
  const data=pick(body,["endpointUrl","wsdlUrl","serviceName","securityMode","certExpiry"]);
  const merged={...row,...data}; for(const key of ["endpointUrl","wsdlUrl"]) { try {const url=new URL(merged[key]);if(!["http:","https:"].includes(url.protocol)) throw new Error();} catch {throw error(`${key} không hợp lệ`);} }
  text(merged.serviceName,"serviceName");text(merged.securityMode,"securityMode");
  return row?save("soapGatewayConfig",row.id,{...data,status:"unknown",lastPingTime:null,avgResponseTime:null}):add("soapGatewayConfig",{isSingleton:true,status:"unknown",...data});
}
async function ping(who) { const row=await soapConfig(who); if(!row) throw error("Chưa cấu hình SOAP"); const start=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),4000); let status="down"; try{const response=await fetch(row.wsdlUrl,{signal:controller.signal});status=response.ok?"healthy":"degraded";await response.body?.cancel();}catch{}finally{clearTimeout(timer);} return save("soapGatewayConfig",row.id,{status,lastPingTime:new Date().toISOString(),avgResponseTime:`${Date.now()-start}ms`}); }
module.exports={shiftOptions,listRequests,createRequest,reviewRequest,deleteRequest,getRequest:async(id,who)=>{const row=await get("request",id);requestRead(row,who);return row;},sendNotification,listNotifications,readNotification,readAllNotifications,notificationSettings,reminders,contentList,contentWrite,contentGet,contentDelete,backlog,listBacklog,soapConfig,ping};
