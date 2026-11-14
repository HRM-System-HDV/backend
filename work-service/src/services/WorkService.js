"use strict";

const { randomUUID } = require("node:crypto");
const { Prisma } = require("@prisma/client");
const database = require("../config/database");
const OrgClient = require("../clients/OrgClient");
const IdentityClient = require("../clients/IdentityClient");
const IntegrationClient = require("../clients/IntegrationClient");
const time = require("../utils/time");
const { requireCaller, isPrivileged } = require("../utils/caller");
const { ValidationError, ForbiddenError, NotFoundError, ConflictError, InternalServerError } = require("../utils/errors");

const DEFAULT_CONFIG = Object.freeze({ gracePeriodMinutes: 0, checkoutWindowMinutes: 60,
  shiftSwapMode: "manager_approval", latePenaltyPct: 10, earlyLeavePenaltyPct: 10,
  earlyCheckinMinutes: 15, allowDoubleCheckin: false, doubleCheckinEarlyMinutes: 0,
  doubleCheckinLateMinutes: 0, requireReasonSwap: true });
const models = ["shiftTemplate", "shift", "attendance", "shiftRegistration", "task", "attendanceConfig"];
const memory = Object.fromEntries(models.map((key) => [key, []]));
let memoryQueue = Promise.resolve();

function fail(message) { throw new ValidationError(message); }
function fields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Dữ liệu đầu vào không hợp lệ");
  for (const key of Object.keys(payload)) if (!allowed.includes(key)) fail(`Thuộc tính không hỗ trợ: ${key}`);
  return { ...payload };
}
function id(value, label = "id") {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(`${label} phải là UUID`);
  return value;
}
function requiredText(value, label) { if (typeof value !== "string" || !value.trim()) fail(`Thiếu ${label}`); return value.trim(); }
// Ca mẫu bắt đầu và kết thúc cùng giờ là lỗi nhập liệu (sẽ thành ca 24 giờ chặn cả ngày).
// Ca qua đêm vẫn hợp lệ: khai báo giờ kết thúc NHỎ HƠN giờ bắt đầu.
function assertDifferentClock(startTime, endTime) {
  if (startTime === endTime) fail("Giờ bắt đầu và giờ kết thúc ca mẫu không được trùng nhau; ca qua đêm khai báo giờ kết thúc nhỏ hơn giờ bắt đầu");
}
function optionalText(value, label) { if (value !== undefined && value !== null && typeof value !== "string") fail(`${label} phải là chuỗi hoặc null`); }
function manager(caller) { requireCaller(caller); if (caller.internal || !isPrivileged(caller)) throw new ForbiddenError("Chỉ admin hoặc quản lý được thực hiện thao tác này"); }
function selfEmployee(value, caller) {
  requireCaller(caller);
  if (caller.internal || isPrivileged(caller)) return id(value || caller.employeeId, "employeeId");
  if (!caller.employeeId || (value && value !== caller.employeeId)) throw new ForbiddenError("Chỉ được thao tác thông tin của chính mình");
  return id(caller.employeeId, "employeeId");
}
// employeeScope: kiểm phạm vi truy cập nhân viên.
// options.requireActive = true: chặn thao tác TẠO MỚI công việc (phân ca, đăng ký ca,
// chấm công) cho nhân viên đã nghỉ việc. Đọc lịch sử và thao tác dọn dẹp ca cũ
// (hủy/xóa ca, chốt giờ vào/ra theo đơn bổ sung công) vẫn được phép.
async function employeeScope(employeeId, caller, options = {}) {
  requireCaller(caller);
  if (!caller.internal && !isPrivileged(caller) && caller.employeeId !== employeeId) throw new ForbiddenError("Không có quyền truy cập nhân viên này");
  const employee = await OrgClient.getEmployee(id(employeeId, "employeeId"));
  if (!employee) throw new NotFoundError("Không tìm thấy nhân viên");
  if (!caller.internal && caller.role === "manager" && (!caller.branchId || employee.branchId !== caller.branchId)) throw new ForbiddenError("Nhân viên không thuộc chi nhánh được quản lý");
  if (options.requireActive && employee.status === "nghỉ việc") throw new ForbiddenError("Nhân viên đã nghỉ việc, không được phân ca hay chấm công mới");
  return employee;
}
async function accessibleEmployees(caller, branchId) {
  requireCaller(caller);
  if (!caller.internal && caller.role === "staff") return [await employeeScope(caller.employeeId, caller)];
  if (!caller.internal && caller.role === "manager") {
    if (!caller.branchId || (branchId && branchId !== caller.branchId)) throw new ForbiddenError("Không có quyền xem chi nhánh này");
    branchId = caller.branchId;
  }
  return OrgClient.listEmployees(branchId);
}
async function rows(model, tx) {
  const db = tx || database.getPrisma();
  return db ? db[model].findMany() : memory[model];
}
async function find(model, key, tx) {
  const db = tx || database.getPrisma();
  const row = db ? await db[model].findUnique({ where: { id: key } }) : memory[model].find((r) => r.id === key);
  if (!row) throw new NotFoundError("Không tìm thấy bản ghi");
  return row;
}
async function create(model, data, tx) {
  const db = tx || database.getPrisma();
  if (db) return db[model].create({ data });
  const row = { id: randomUUID(), ...(model === "attendanceConfig" ? {} : { createdAt: new Date(Date.now()) }), ...data };
  memory[model].push(row); return row;
}
async function update(model, key, data, tx) {
  const db = tx || database.getPrisma();
  if (db) return db[model].update({ where: { id: key }, data });
  const row = await find(model, key); Object.assign(row, data); return row;
}
async function remove(model, key, tx) {
  const db = tx || database.getPrisma();
  if (db) return db[model].delete({ where: { id: key } });
  await find(model, key); memory[model] = memory[model].filter((r) => r.id !== key); return { ok: true };
}
async function atomic(fn) {
  const db = database.getPrisma();
  if (db) return db.$transaction(fn, { isolationLevel: "Serializable" });
  const previous = memoryQueue; let unlock;
  memoryQueue = new Promise((resolve) => { unlock = resolve; }); await previous;
  const backup = structuredClone(memory);
  try { return await fn(null); }
  catch (error) { for (const model of models) memory[model] = backup[model]; throw error; }
  finally { unlock(); }
}
// Thứ tự áp dụng: row theo chi nhánh -> row mặc định toàn hệ thống (branchId NULL) -> DEFAULT_CONFIG.
function pickConfig(all, branchId) {
  return (branchId ? all.find((r) => r.branchId === branchId) : null) || all.find((r) => !r.branchId) || { ...DEFAULT_CONFIG };
}
async function configValue(tx, branchId = null) { return pickConfig(await rows("attendanceConfig", tx), branchId); }
// Chi nhánh mà caller được thao tác config: admin/internal chọn tự do (NULL = mặc định hệ thống);
// manager/staff chỉ được chi nhánh của chính mình.
function configBranch(caller, requestedBranchId, { write = false } = {}) {
  requireCaller(caller);
  if (write && (caller.internal || !isPrivileged(caller))) throw new ForbiddenError("Chỉ admin hoặc quản lý được thay đổi cấu hình chấm công");
  if (requestedBranchId !== undefined && requestedBranchId !== null && requestedBranchId !== "") {
    const branchId = id(requestedBranchId, "branchId");
    if (!caller.internal && caller.role !== "admin" && branchId !== caller.branchId) throw new ForbiddenError("Chỉ được thao tác cấu hình chi nhánh của mình");
    return branchId;
  }
  if (caller.internal || caller.role === "admin") return null;
  return caller.branchId || null;
}
async function getConfig(caller, requestedBranchId) {
  const branchId = configBranch(caller, requestedBranchId);
  return { ...pickConfig(await rows("attendanceConfig"), branchId) };
}
async function updateConfig(payload, caller, requestedBranchId) {
  const branchId = configBranch(caller, requestedBranchId, { write: true });
  if (caller.role === "manager" && !branchId) throw new ForbiddenError("Tài khoản quản lý chưa được gán chi nhánh để cấu hình");
  const data = fields(payload, Object.keys(DEFAULT_CONFIG));
  for (const [key, value] of Object.entries(data)) {
    if (["allowDoubleCheckin", "requireReasonSwap"].includes(key)) { if (typeof value !== "boolean") fail(`${key} phải là boolean`); }
    else if (key === "shiftSwapMode") { if (!["manager_approval", "mutual_acceptance"].includes(value)) fail("Chế độ đổi ca không hợp lệ"); }
    else if (!Number.isInteger(value) || value < 0 || (key.endsWith("Pct") && value > 100)) fail(`Giá trị ${key} không hợp lệ`);
  }
  return atomic(async (tx) => {
    const existing = (await rows("attendanceConfig", tx)).find((r) => (r.branchId || null) === branchId);
    return existing ? update("attendanceConfig", existing.id, data, tx) : create("attendanceConfig", { ...DEFAULT_CONFIG, branchId, ...data }, tx);
  });
}

async function listTemplates(caller) { requireCaller(caller); return rows("shiftTemplate"); }
async function createTemplate(payload, caller) {
  manager(caller);
  const data = fields(payload, ["templateCode", "name", "startTime", "endTime"]);
  data.templateCode = requiredText(data.templateCode, "templateCode"); data.name = requiredText(data.name, "name");
  time.clock(data.startTime); time.clock(data.endTime);
  assertDifferentClock(data.startTime, data.endTime);
  return atomic(async (tx) => {
    if ((await rows("shiftTemplate", tx)).some((r) => r.templateCode === data.templateCode)) throw new ConflictError("Mã ca mẫu đã tồn tại");
    return create("shiftTemplate", data, tx);
  });
}
async function updateTemplate(key, payload, caller) {
  manager(caller); id(key);
  const data = fields(payload, ["name", "startTime", "endTime"]);
  if (data.name !== undefined) data.name = requiredText(data.name, "name");
  for (const key of ["startTime", "endTime"]) if (data[key] !== undefined) time.clock(data[key]);
  return atomic(async (tx) => {
    const current = await find("shiftTemplate", key, tx);
    assertDifferentClock(data.startTime ?? current.startTime, data.endTime ?? current.endTime);
    return update("shiftTemplate", key, data, tx);
  });
}
async function deleteTemplate(key, caller) {
  manager(caller); id(key);
  return atomic(async (tx) => {
    for (const model of ["shift", "shiftRegistration", "task"]) if ((await rows(model, tx)).some((r) => r.templateId === key)) throw new ConflictError("Ca mẫu đang được sử dụng");
    return remove("shiftTemplate", key, tx);
  });
}
function shiftProjection(shift, attendance, cfg) {
  const { start, end } = time.bounds(shift); const now = Date.now();
  const checkOutExpired = now >= end.getTime() + cfg.checkoutWindowMinutes * 60000;
  return { ...shift, attendance: attendance || null,
    attendanceState: attendance?.checkOut ? "completed" : attendance?.checkIn ? (checkOutExpired ? "missed_checkout" : "working") : (now >= start.getTime() + 60000 ? "missed_checkin" : "not_started"),
    canCheckout: !!attendance?.checkIn && !attendance.checkOut && !checkOutExpired && shift.status !== "đã hủy" };
}
async function listShifts(query = {}, caller) {
  requireCaller(caller);
  const employees = query.employeeId ? [await employeeScope(query.employeeId, caller)] : await accessibleEmployees(caller, query.branchId);
  const allowed = new Set(employees.map((e) => e.id));
  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const cfgRows = await rows("attendanceConfig"); const attendance = await rows("attendance");
  if (query.workDate) time.day(query.workDate); if (query.month) time.month(query.month);
  return (await rows("shift")).filter((r) => allowed.has(r.employeeId) && (!query.workDate || time.day(r.workDate) === query.workDate) && (!query.month || time.day(r.workDate).startsWith(query.month)))
    .map((r) => { const branchId = r.branchId ?? byEmployee.get(r.employeeId)?.branchId ?? null;
      return shiftProjection({ ...r, branchId }, attendance.find((a) => a.shiftId === r.id), pickConfig(cfgRows, branchId)); });
}
// Lấy ca "thô" (KHÔNG kèm chấm công) — dùng nội bộ cho các thao tác ghi
// (sửa/xóa ca, ghi chấm công, kiểm tra quyền chấm công).
async function getRawShift(key, caller) {
  const shift = await find("shift", id(key));
  const employee = await employeeScope(shift.employeeId, caller);
  return { ...shift, branchId: shift.branchId ?? employee.branchId ?? null };
}
// Hàm public: trả ca KÈM chấm công và trạng thái chấm công (attendanceState/canCheckout)
// để service khác (ví dụ integration kiểm tra "ca đã check-in chưa") dùng được.
async function getShiftById(key, caller) {
  const shift = await getRawShift(key, caller);
  const cfg = await configValue(null, shift.branchId);
  const attendance = (await rows("attendance")).find((a) => a.shiftId === shift.id) || null;
  return shiftProjection(shift, attendance, cfg);
}
function shiftConflictExclusions(excluding) {
  return Array.isArray(excluding) ? excluding : [excluding];
}
async function checkShiftConflict(candidate, excluding, tx) {
  const skip = new Set(shiftConflictExclusions(excluding));
  const { start, end } = time.bounds(candidate);
  for (const row of await rows("shift", tx)) {
    if (skip.has(row.id) || row.employeeId !== candidate.employeeId) continue;
    // Ca ĐÃ HỦY không tính vào kiểm tra trùng/chồng giờ (cả ca đang xét lẫn ca đã có):
    // hủy ca xong vẫn được phân lại đúng ca mẫu đó trong ngày.
    if (row.status === "đã hủy" || candidate.status === "đã hủy") continue;
    if (time.day(row.workDate) === time.day(candidate.workDate) && row.templateId === candidate.templateId) throw new ConflictError("Nhân viên đã có ca này trong ngày");
    const other = time.bounds(row);
    if (start < other.end && other.start < end) throw new ConflictError("Nhân viên đã có ca khác chồng giờ");
  }
}
async function createShift(payload, caller) {
  manager(caller);
  const data = fields(payload, ["branchId", "employeeId", "templateId", "workDate"]);
  const employee = await employeeScope(id(data.employeeId), caller, { requireActive: true });
  id(data.branchId, "branchId");
  if (data.branchId !== employee.branchId) fail("Chi nhánh phân ca phải khớp chi nhánh của nhân viên");
  id(data.templateId, "templateId"); data.workDate = time.date(data.workDate);
  return atomic(async (tx) => {
    const template = await find("shiftTemplate", data.templateId, tx);
    const candidate = { ...data, scheduledStart: template.startTime, scheduledEnd: template.endTime, status: "đang làm" };
    await checkShiftConflict(candidate, null, tx); return create("shift", candidate, tx);
  });
}
async function updateShift(key, payload, caller) {
  manager(caller); id(key);
  const data = fields(payload, ["branchId", "employeeId", "templateId", "workDate", "status"]);
  const current = await getRawShift(key, caller);
  if (data.employeeId || data.branchId) {
    const employee = await employeeScope(id(data.employeeId || current.employeeId), caller, { requireActive: true });
    if (data.branchId !== undefined && id(data.branchId, "branchId") !== employee.branchId) fail("Chi nhánh phân ca phải khớp chi nhánh của nhân viên");
    data.branchId = employee.branchId;
  }
  if (data.status && !["đang làm", "đã hủy"].includes(data.status)) fail("Trạng thái ca không hợp lệ");
  if (data.workDate) data.workDate = time.date(data.workDate);
  if (data.templateId) id(data.templateId);
  return atomic(async (tx) => {
    const live = await find("shift", current.id, tx);
    if ((await rows("attendance", tx)).some((a) => a.shiftId === key && (a.checkIn || a.checkOut)) || Date.now() >= time.bounds(live).start.getTime()) throw new ConflictError("Chỉ được thay đổi ca chưa đến giờ và chưa chấm công");
    if (data.templateId) { const template = await find("shiftTemplate", data.templateId, tx); data.scheduledStart = template.startTime; data.scheduledEnd = template.endTime; }
    const candidate = { ...live, ...data }; await checkShiftConflict(candidate, key, tx);
    return update("shift", key, data, tx);
  });
}
// Hoán đổi ca theo đơn shift_swap đã được duyệt/chấp nhận. Đây là thao tác NỘI BỘ:
// integration-service gọi bằng x-internal-token vì người phản hồi đơn có thể là nhân
// viên (chế độ mutual_acceptance) nên không vượt qua được manager() của PUT /shifts/:id.
// Đổi lịch THẬT (khác với các loại đơn khác vốn chỉ là mẫu đơn) và chỉ đổi khi cả hai
// ca còn chưa tới giờ và chưa chấm công; thất bại thì đơn vẫn còn pending.
async function swapShiftEmployees(payload, caller) {
  requireCaller(caller);
  if (!caller.internal) throw new ForbiddenError("Chỉ nghiệp vụ nội bộ được hoán đổi ca");
  const data = fields(payload, ["sourceShiftId", "targetShiftId", "targetEmployeeId"]);
  const sourceKey = id(data.sourceShiftId, "sourceShiftId");
  const targetEmployeeId = id(data.targetEmployeeId, "targetEmployeeId");
  const targetKey = data.targetShiftId ? id(data.targetShiftId, "targetShiftId") : null;
  const source = await getRawShift(sourceKey, caller);
  const targetEmployee = await employeeScope(targetEmployeeId, caller, { requireActive: true });
  let target = null;
  if (targetKey) {
    target = await getRawShift(targetKey, caller);
    if (target.employeeId !== targetEmployeeId) throw new ConflictError("Ca đích không thuộc nhân viên được nhờ");
    await employeeScope(source.employeeId, caller, { requireActive: true });
  }
  for (const row of [source, target].filter(Boolean)) {
    if (row.status === "đã hủy") throw new ConflictError("Ca đã hủy, không hoán đổi được");
    if (row.branchId !== targetEmployee.branchId) throw new ConflictError("Ca và nhân viên được nhờ phải ở cùng chi nhánh");
  }
  const swapped = [sourceKey, ...(targetKey ? [targetKey] : [])];
  return atomic(async (tx) => {
    const liveSource = await find("shift", sourceKey, tx);
    const liveTarget = targetKey ? await find("shift", targetKey, tx) : null;
    const attended = await rows("attendance", tx);
    for (const row of [liveSource, liveTarget].filter(Boolean)) {
      if (attended.some((a) => a.shiftId === row.id && (a.checkIn || a.checkOut)) || Date.now() >= time.bounds(row).start.getTime()) throw new ConflictError("Chỉ được hoán đổi ca chưa đến giờ và chưa chấm công");
    }
    await checkShiftConflict({ ...liveSource, employeeId: targetEmployeeId }, swapped, tx);
    if (liveTarget) await checkShiftConflict({ ...liveTarget, employeeId: source.employeeId }, swapped, tx);
    const savedSource = await update("shift", sourceKey, { employeeId: targetEmployeeId }, tx);
    const savedTarget = liveTarget ? await update("shift", targetKey, { employeeId: source.employeeId }, tx) : null;
    return { source: savedSource, target: savedTarget };
  });
}
async function deleteShift(key, caller) {
  manager(caller); await getRawShift(key, caller);
  return atomic(async (tx) => {
    const shift = await find("shift", key, tx);
    if ((await rows("attendance", tx)).some((a) => a.shiftId === key) || Date.now() >= time.bounds(shift).start.getTime()) throw new ConflictError("Ca đã bắt đầu hoặc có lịch sử chấm công, không thể xóa");
    return remove("shift", key, tx);
  });
}
async function registerShift(payload, caller) {
  const data = fields(payload, ["employeeId", "templateId", "registerDate"]);
  data.employeeId = selfEmployee(data.employeeId, caller); const employee = await employeeScope(data.employeeId, caller, { requireActive: true });
  id(data.templateId); data.registerDate = time.date(data.registerDate); data.branchId = employee.branchId || null;
  return atomic(async (tx) => {
    await find("shiftTemplate", data.templateId, tx);
    if ((await rows("shiftRegistration", tx)).some((r) => r.employeeId === data.employeeId && r.templateId === data.templateId && time.day(r.registerDate) === time.day(data.registerDate))) throw new ConflictError("Đã đăng ký ca này trong ngày");
    return create("shiftRegistration", data, tx);
  });
}
async function listRegistrations(query = {}, caller) {
  const employees = query.employeeId ? [await employeeScope(query.employeeId, caller)] : await accessibleEmployees(caller, query.branchId);
  const allowed = new Set(employees.map((e) => e.id));
  if (query.registerDate) time.day(query.registerDate);
  return (await rows("shiftRegistration")).filter((r) => allowed.has(r.employeeId) && (!query.registerDate || time.day(r.registerDate) === query.registerDate));
}
async function deleteRegistration(key, caller) {
  const row = await find("shiftRegistration", id(key)); await employeeScope(row.employeeId, caller);
  return atomic((tx) => remove("shiftRegistration", key, tx));
}

async function wifi(employee, payload) {
  if (!employee.branchId) throw new ForbiddenError("Nhân viên chưa được gán chi nhánh để chấm công");
  const bssid = String(payload?.wifi?.bssid || "").trim().toLowerCase();
  const ssid = String(payload?.wifi?.ssid || "").trim();
  if (!bssid) throw new ForbiddenError("Phải kết nối Wi-Fi hợp lệ trước khi mở ca chấm công");
  const configs = await IntegrationClient.getWifiConfigs(employee.branchId);
  if (!configs.some((r) => r.branchId === employee.branchId && r.status === "hoạt động" && String(r.bssid).toLowerCase() === bssid && (!ssid || r.ssid === ssid))) throw new ForbiddenError("Wi-Fi không thuộc chi nhánh được phép chấm công");
}
async function preflight(payload, caller) {
  fields(payload, ["employeeId", "wifi"]);
  const employeeId = selfEmployee(payload.employeeId, caller); const employee = await employeeScope(employeeId, caller, { requireActive: true });
  await wifi(employee, payload);
  const cfg = await configValue(null, employee.branchId);
  const now = Date.now();
  const available = (await listShifts({ employeeId }, caller)).filter((r) => {
    const { start, end } = time.bounds(r);
    return time.day(r.workDate) === time.today() || (!r.attendance?.checkOut && start.getTime() <= now && end.getTime() + cfg.checkoutWindowMinutes * 60000 > now);
  });
  return { workDate: time.today(), shifts: available,
    config: Object.fromEntries(["earlyCheckinMinutes", "checkoutWindowMinutes", "allowDoubleCheckin", "doubleCheckinEarlyMinutes", "doubleCheckinLateMinutes"].map((key) => [key, cfg[key]])) };
}
function attendanceEvaluation(row, shift, employee, cfg) {
  if (!row.checkIn || !row.checkOut) return { ...row, penaltyAmount: "0", earnedSalary: "0", workedSeconds: 0, complete: false, shift };
  const seconds = Math.max(0, (new Date(row.checkOut) - new Date(row.checkIn)) / 1000);
  const { start, end } = time.bounds(shift);
  const late = new Date(row.checkIn) > new Date(start.getTime() + cfg.gracePeriodMinutes * 60000);
  const early = new Date(row.checkOut) < end;
  const rate = new Prisma.Decimal(String(employee.salary));
  if (rate.isNegative() || !["hourly", "monthly"].includes(employee.salaryType) || (employee.salaryType === "monthly" && (!Number.isInteger(employee.standardWorkDays) || employee.standardWorkDays <= 0))) fail("Thông tin lương nhân viên không hợp lệ");
  const earned = employee.salaryType === "hourly" ? rate.mul(seconds).div(3600) : rate.div(employee.standardWorkDays);
  const pct = (late ? cfg.latePenaltyPct : 0) + (early ? cfg.earlyLeavePenaltyPct : 0);
  return { ...row, penaltyAmount: earned.mul(pct).div(100).toDecimalPlaces(0).toFixed(0), earnedSalary: earned.toFixed(), workedSeconds: seconds, complete: true,
    status: late && early ? "late_early_leave" : late ? "late" : early ? "early_leave" : "present", shift };
}
async function attendanceAccess(payload, caller) {
  requireCaller(caller);
  const shift = await getRawShift(id(payload.shiftId, "shiftId"), caller);
  if (payload.employeeId && payload.employeeId !== shift.employeeId) throw new ForbiddenError("Nhân viên không khớp ca");
  if (shift.status === "đã hủy") throw new ConflictError("Ca đã hủy không được chấm công");
  // Chấm công là thao tác tạo mới trên ca của nhân viên => nhân viên đã nghỉ việc thì chặn.
  const employee = await employeeScope(shift.employeeId, caller, { requireActive: true }); await wifi(employee, payload);
  return { shift, employee };
}
async function checkin(payload, caller) {
  fields(payload, ["employeeId", "shiftId", "wifi"]);
  const { shift } = await attendanceAccess(payload, caller);
  return atomic(async (tx) => {
    const live = await find("shift", shift.id, tx); const cfg = await configValue(tx, shift.branchId); const now = new Date(Date.now()); const { start, end } = time.bounds(live);
    if (live.employeeId !== shift.employeeId) throw new ConflictError("Phân công ca vừa thay đổi, vui lòng tải lại");
    if (live.status === "đã hủy" || now >= end) throw new ConflictError("Ca đã kết thúc hoặc đã hủy");
    if (now < new Date(start.getTime() - cfg.earlyCheckinMinutes * 60000)) fail("Chưa đến khoảng thời gian cho phép check-in");
    const current = (await rows("attendance", tx)).find((r) => r.shiftId === shift.id);
    if (current?.checkIn || current?.checkOut) throw new ConflictError("Ca đã được check-in");
    const data = { employeeId: live.employeeId, shiftId: live.id, workDate: live.workDate, checkIn: now, checkOut: null, penaltyAmount: "0",
      status: now > new Date(start.getTime() + cfg.gracePeriodMinutes * 60000) ? "late" : "present" };
    return current ? update("attendance", current.id, data, tx) : create("attendance", data, tx);
  });
}
async function checkout(payload, caller) {
  fields(payload, ["employeeId", "shiftId", "wifi"]);
  const { shift, employee } = await attendanceAccess(payload, caller);
  return atomic(async (tx) => {
    const live = await find("shift", shift.id, tx); const cfg = await configValue(tx, shift.branchId); const now = new Date(Date.now());
    const current = (await rows("attendance", tx)).find((r) => r.shiftId === live.id);
    if (live.status === "đã hủy" || live.employeeId !== shift.employeeId) throw new ConflictError("Ca đã hủy hoặc phân công vừa thay đổi");
    if (!current?.checkIn) fail("Chưa có check-in cho ca này");
    if (current.checkOut) throw new ConflictError("Ca đã được checkout");
    if (now >= new Date(time.bounds(live).end.getTime() + cfg.checkoutWindowMinutes * 60000)) fail("Ca đã hết hạn checkout, vui lòng chấm công ca khác hoặc gửi đơn");
    if (now < new Date(current.checkIn)) fail("Giờ ra không thể trước giờ vào");
    const evaluated = attendanceEvaluation({ ...current, checkOut: now }, live, employee, cfg);
    return update("attendance", current.id, { checkOut: now, penaltyAmount: evaluated.penaltyAmount, status: evaluated.status, penaltyNote: evaluated.status === "present" ? null : "Phạt phần trăm theo giờ vào/ra ca" }, tx);
  });
}
async function doubleAttendance(payload, caller) {
  fields(payload, ["shiftId", "nextShiftId", "employeeId", "wifi"]);
  const { shift, employee } = await attendanceAccess(payload, caller);
  const next = await getRawShift(id(payload.nextShiftId, "nextShiftId"), caller);
  if (next.employeeId !== shift.employeeId || next.id === shift.id) fail("Hai ca phải khác nhau và cùng nhân viên");
  return atomic(async (tx) => {
    const previous = await find("shift", shift.id, tx); const following = await find("shift", next.id, tx); const cfg = await configValue(tx, shift.branchId);
    const join = time.bounds(previous).end; const nextStart = time.bounds(following).start; const now = Date.now();
    if (!cfg.allowDoubleCheckin) fail("Chấm công kép đang tắt");
    if (previous.status === "đã hủy" || following.status === "đã hủy" || previous.employeeId !== employee.id || following.employeeId !== employee.id || join.getTime() !== nextStart.getTime()) fail("Hai ca không liền nhau, đã hủy hoặc vừa đổi người");
    if (now < join.getTime() - cfg.doubleCheckinEarlyMinutes * 60000 || now > join.getTime() + cfg.doubleCheckinLateMinutes * 60000 || now >= join.getTime() + cfg.checkoutWindowMinutes * 60000) fail("Ngoài khoảng cho phép chấm công kép");
    const all = await rows("attendance", tx); const before = all.find((r) => r.shiftId === previous.id); const after = all.find((r) => r.shiftId === following.id);
    if (!before?.checkIn || before.checkOut || after?.checkIn || after?.checkOut) throw new ConflictError("Trạng thái chấm công hai ca không còn hợp lệ");
    if (join < new Date(before.checkIn)) fail("Mốc nối ca không thể trước giờ vào");
    const evaluated = attendanceEvaluation({ ...before, checkOut: join }, previous, employee, cfg);
    const completed = await update("attendance", before.id, { checkOut: join, status: evaluated.status, penaltyAmount: evaluated.penaltyAmount }, tx);
    const data = { shiftId: following.id, employeeId: following.employeeId, workDate: following.workDate, checkIn: join, checkOut: null, penaltyAmount: "0", status: "present" };
    const opened = after ? await update("attendance", after.id, data, tx) : await create("attendance", data, tx);
    return { previous: completed, next: opened };
  });
}
async function saveAttendance(shiftId, payload, caller) {
  manager(caller); fields(payload, ["checkIn", "checkOut", "penaltyNote"]);
  optionalText(payload.penaltyNote, "penaltyNote");
  const shift = await getRawShift(id(shiftId), caller); const employee = await employeeScope(shift.employeeId, caller);
  const checkIn = time.timestamp(payload.checkIn); const checkOut = time.timestamp(payload.checkOut);
  const { start, end } = time.bounds(shift);
  if (shift.status === "đã hủy" || checkOut < checkIn || checkIn >= end || checkOut < start || checkIn > new Date(Date.now()) || checkOut > new Date(Date.now())) fail("Giờ chấm công được chọn không hợp lệ cho ca");
  const saved = await atomic(async (tx) => {
    const current = (await rows("attendance", tx)).find((r) => r.shiftId === shift.id);
    const data = { shiftId: shift.id, employeeId: shift.employeeId, workDate: shift.workDate, checkIn, checkOut, penaltyNote: payload.penaltyNote || null };
    const evaluated = attendanceEvaluation(data, shift, employee, await configValue(tx, shift.branchId)); data.penaltyAmount = evaluated.penaltyAmount; data.status = evaluated.status;
    return current ? update("attendance", current.id, data, tx) : create("attendance", data, tx);
  });
  // Audit is in a different service/DB; a logging outage must not claim the committed save failed.
  await IntegrationClient.writeBacklog({ userId: caller.userId, userName: caller.name || "Người dùng", userRole: caller.role, action: "attendance_saved", module: "work", entityType: "attendance", entityId: saved.id, targetName: `${employee.name || employee.id} ${time.day(shift.workDate)}` })
    .catch((error) => console.warn("[work-service] Đã lưu công nhưng chưa ghi được nhật ký:", error.message));
  return saved;
}
async function listAttendance(query = {}, caller) {
  requireCaller(caller);
  const employees = query.employeeId ? [await employeeScope(query.employeeId, caller)] : await accessibleEmployees(caller, query.branchId);
  const byId = new Map(employees.map((e) => [e.id, e])); const shifts = await rows("shift"); const cfgRows = await rows("attendanceConfig");
  if (query.month) time.month(query.month); if (query.workDate) time.day(query.workDate);
  return (await rows("attendance")).filter((r) => byId.has(r.employeeId) && (!query.month || time.day(r.workDate).startsWith(query.month)) && (!query.workDate || time.day(r.workDate) === query.workDate))
    .map((r) => { const shift = shifts.find((s) => s.id === r.shiftId); if (!shift) throw new InternalServerError("Chấm công thiếu ca tham chiếu");
      return attendanceEvaluation(r, shift, byId.get(r.employeeId), pickConfig(cfgRows, shift.branchId ?? byId.get(r.employeeId)?.branchId ?? null)); });
}

async function taskScope(task, caller) {
  requireCaller(caller);
  if (task.assignedTo) return employeeScope(task.assignedTo, caller);
  if (caller.internal || caller.role === "admin") return;
  const branchId = caller.role === "staff" ? (await employeeScope(caller.employeeId, caller)).branchId : caller.branchId;
  if (!branchId || branchId !== task.branchId) throw new ForbiddenError("Công việc không thuộc chi nhánh của bạn");
  if (caller.role === "staff") {
    const shifts = await rows("shift");
    if (!shifts.some((r) => r.employeeId === caller.employeeId && r.templateId === task.templateId && time.day(r.workDate) === time.day(task.workDate) && r.status !== "đã hủy")) throw new ForbiddenError("Bạn không được phân ca của công việc này");
  }
}
const TASK_FIELDS = ["title", "description", "assignedTo", "branchId", "dueDate", "workDate", "templateId", "priority", "requirePhoto", "status", "proofPhotoUrl"];
async function validateTask(data, caller, tx) {
  data.title = requiredText(data.title, "title");
  for (const key of ["description", "priority", "proofPhotoUrl"]) optionalText(data[key], key);
  if (!["pending", "in_progress", "done"].includes(data.status || "pending")) fail("Trạng thái công việc không hợp lệ");
  if (data.requirePhoto !== undefined && typeof data.requirePhoto !== "boolean") fail("requirePhoto phải là boolean");
  if (data.assignedTo) { const employee = await employeeScope(id(data.assignedTo), caller); data.branchId = employee.branchId; }
  else {
    id(data.branchId, "branchId"); id(data.templateId, "templateId"); data.workDate = time.date(data.workDate);
    await find("shiftTemplate", data.templateId, tx);
    if (caller.role === "manager" && caller.branchId !== data.branchId) throw new ForbiddenError("Không được giao việc sang chi nhánh khác");
  }
  if (data.dueDate !== undefined && data.dueDate !== null) {
    // Keep date-only callers compatible; new clients send an ISO timestamp with timezone.
    const value = data.dueDate;
    data.dueDate = value instanceof Date ? time.timestamp(value.toISOString())
      : /^\d{4}-\d{2}-\d{2}$/.test(value) ? time.timestamp(`${time.day(value)}T00:00:00+07:00`)
      : time.timestamp(value);
  }
  if (data.workDate !== undefined && data.workDate !== null) data.workDate = time.date(data.workDate);
  if (data.templateId) await find("shiftTemplate", id(data.templateId), tx);
  // Bắt buộc ảnh minh chứng khi hoàn thành chỉ áp dụng cho nhân viên;
  // admin/manager được duyệt đặc cách khi task requirePhoto chưa có ảnh.
  if (data.status === "done" && data.requirePhoto && !data.proofPhotoUrl && !isPrivileged(caller)) fail("Công việc yêu cầu ảnh minh chứng trước khi hoàn thành");
  return data;
}
async function listTasks(query = {}, caller) {
  requireCaller(caller);
  const output = [];
  if (query.workDate) time.day(query.workDate);
  for (const task of await rows("task")) {
    if (query.status && task.status !== query.status || query.assignedTo && task.assignedTo !== query.assignedTo || query.workDate && (!task.workDate || time.day(task.workDate) !== query.workDate)) continue;
    try { await taskScope(task, caller); output.push(task); } catch (error) { if (error.status !== 403) throw error; }
  }
  const names = new Map();
  return Promise.all(output.map((task) => withPhotoSubmitterName(task, names)));
}
async function withPhotoSubmitterName(task, names = new Map()) {
  if (!task.photoSubmittedBy) return { ...task, photoSubmittedByName: null };
  if (!names.has(task.photoSubmittedBy)) {
    names.set(task.photoSubmittedBy, IdentityClient.getUserName(task.photoSubmittedBy)
      .then((user) => user.name || null).catch(() => null));
  }
  return { ...task, photoSubmittedByName: await names.get(task.photoSubmittedBy) };
}
async function createTask(payload, caller) {
  manager(caller); const data = fields(payload, TASK_FIELDS);
  return atomic(async (tx) => {
    await validateTask(data, caller, tx);
    if (data.status === "done") fail("Tạo công việc mới ở trạng thái chưa hoàn thành");
    return create("task", { ...data, assignedTo: data.assignedTo || null, assignedBy: caller.userId, assignedByName: caller.name,
      status: data.status || "pending", priority: data.priority || "normal", requirePhoto: data.requirePhoto || false }, tx);
  });
}
async function getTaskById(key, caller) { const task = await find("task", id(key)); await taskScope(task, caller); return withPhotoSubmitterName(task); }
async function updateTask(key, payload, caller) {
  const current = await getTaskById(key, caller);
  const data = fields(payload, isPrivileged(caller) ? TASK_FIELDS : ["status", "proofPhotoUrl"]);
  return atomic(async (tx) => {
    const live = await find("task", key, tx);
    if (live.status === "done" && !isPrivileged(caller)) throw new ConflictError("Công việc đã được hoàn thành");
    const validated = await validateTask({ ...current, ...data }, isPrivileged(caller) ? caller : { ...caller, internal: true }, tx);
    const changed = { ...data };
    for (const field of ["branchId", "workDate", "dueDate"]) if (validated[field] !== undefined) changed[field] = validated[field];
    if (data.proofPhotoUrl && data.proofPhotoUrl !== live.proofPhotoUrl) { changed.photoSubmittedBy = caller.userId; changed.photoSubmittedAt = new Date(Date.now()); }
    if (data.status === "done") changed.completedAt = new Date(Date.now());
    else if (data.status) changed.completedAt = null;
    return update("task", key, changed, tx);
  });
}
async function deleteTask(key, caller) {
  manager(caller); const row = await getTaskById(key, caller);
  await atomic((tx) => remove("task", key, tx));
  await IntegrationClient.deleteFileByUrl(row.proofPhotoUrl); return { ok: true };
}
module.exports = { getConfig, updateConfig, listTemplates, createTemplate, updateTemplate, deleteTemplate,
  listShifts, createShift, updateShift, swapShiftEmployees, deleteShift, getShiftById, registerShift, listRegistrations, deleteRegistration,
  preflight, checkin, checkout, doubleAttendance, saveAttendance, listAttendance,
  listTasks, createTask, updateTask, deleteTask, getTaskById };
