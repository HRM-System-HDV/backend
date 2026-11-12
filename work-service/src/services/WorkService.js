"use strict";

const database = require("../config/database");
const IntegrationClient = require("../clients/IntegrationClient");
const { isPrivileged } = require("../utils/caller");
const { toVnDate, toVnDateTime, parseDate, dateKey, monthKey, todayVn } = require("../utils/dateFormat");
const { NotFoundError, ValidationError, ForbiddenError, InternalServerError } = require("../utils/errors");

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const seedShifts = [];
const seedTasks = [];
let memoryShifts = [];
let memoryAttendances = [];
let memoryTasks = [];
let memoryRegistrations = [];
let memoryConfig = { id: "default", latePenaltyAmount: 20000, earlyLeavePenaltyAmount: 0, gracePeriodMinutes: 5, checkoutWindowMinutes: 60, autoCloseShift: false, shiftSwapMode: "manual", latePenaltyPct: 10, earlyLeavePenaltyPct: 10, earlyCheckinMinutes: 15, maxPenaltiesPerMonth: 10, deductOnCheckout: true, allowDoubleCheckin: true, maxCheckinsPerDay: 3, maxSwapsPerMonth: 3, requireReasonSwap: true };
let memoryTemplates = [];

function sanitizeShiftPayload(payload = {}) {
  const allowed = [
    "employeeId",
    "branchSlug",
    "date",
    "template",
    "scheduledStart",
    "scheduledEnd",
    "checkIn",
    "checkOut",
    "status",
    "note",
    "isRecurring",
  ];
  const cleaned = {};
  for (const k of allowed) {
    if (payload[k] !== undefined) {
      cleaned[k] = payload[k];
    }
  }
  // Ngày ca luôn lưu DD/MM/YYYY, bất kể client gửi ISO hay dấu gạch ngang.
  if (cleaned.date !== undefined && cleaned.date !== null && cleaned.date !== "") {
    cleaned.date = toVnDate(cleaned.date) || String(cleaned.date).trim();
  }
  return cleaned;
}

function sanitizeAttendanceConfigPayload(payload = {}) {
  const allowed = [
    "latePenaltyAmount",
    "earlyLeavePenaltyAmount",
    "gracePeriodMinutes",
    "checkoutWindowMinutes",
    "autoCloseShift",
    "shiftSwapMode",
    "latePenaltyPct",
    "earlyLeavePenaltyPct",
    "earlyCheckinMinutes",
    "maxPenaltiesPerMonth",
    "deductOnCheckout",
    "allowDoubleCheckin",
    "maxCheckinsPerDay",
    "maxSwapsPerMonth",
    "requireReasonSwap",
  ];
  const cleaned = {};
  for (const k of allowed) {
    if (payload[k] !== undefined) {
      if (typeof payload[k] === "boolean") {
        cleaned[k] = payload[k];
      } else if (typeof payload[k] === "number") {
        cleaned[k] = Math.round(payload[k]);
      } else if (typeof payload[k] === "string") {
        if (k === "shiftSwapMode") {
          cleaned[k] = payload[k];
        } else {
          const parsed = parseInt(payload[k], 10);
          if (!isNaN(parsed)) {
            cleaned[k] = parsed;
          }
        }
      }
    }
  }
  return cleaned;
}

function sanitizeTaskPayload(payload = {}) {
  const allowed = [
    "title",
    "description",
    "assignedTo",
    "branchSlug",
    "dueDate",
    "status",
    "sourceType",
    "assignedByName",
    "shiftName",
    "priority",
    "assignedToEmail",
    "assignedToName",
    "completedAt",
    "requirePhoto",
    "proofPhotoUrl",
    "photoSubmittedBy",
    "photoSubmittedAt",
  ];
  const cleaned = {};
  for (const k of allowed) {
    if (payload[k] !== undefined) {
      cleaned[k] = payload[k];
    }
  }
  for (const k of ["dueDate", "completedAt", "photoSubmittedAt"]) {
    if (cleaned[k] !== undefined && cleaned[k] !== null && cleaned[k] !== "") {
      cleaned[k] = toVnDateTime(cleaned[k]) || String(cleaned[k]).trim();
    }
  }
  return cleaned;
}

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const count = await prisma.shiftTemplate.count();
      if (count === 0) {
        await prisma.shiftTemplate.createMany({
          data: [
            { name: "Ca Sáng", startTime: "07:00", endTime: "14:00" },
            { name: "Ca Chiều", startTime: "14:00", endTime: "22:00" },
            { name: "Ca Tối", startTime: "18:00", endTime: "23:00" },
          ],
        });
        console.log("[work-service] Đã khởi tạo 3 khung ca mẫu mặc định vào DB");
      }

      const existingConfig = await prisma.attendanceConfig.findUnique({ where: { id: "default" } });
      if (!existingConfig) {
        await prisma.attendanceConfig.create({
          data: {
            id: "default",
            latePenaltyAmount: 20000,
            earlyLeavePenaltyAmount: 0,
            gracePeriodMinutes: 5,
            checkoutWindowMinutes: 60,
            autoCloseShift: false,
            shiftSwapMode: "manual",
            latePenaltyPct: 10,
            earlyLeavePenaltyPct: 10,
            earlyCheckinMinutes: 15,
            maxPenaltiesPerMonth: 10,
            deductOnCheckout: true,
            allowDoubleCheckin: true,
            maxCheckinsPerDay: 3,
            maxSwapsPerMonth: 3,
            requireReasonSwap: true,
          },
        });
        console.log("[work-service] Đã khởi tạo attendanceConfig default vào DB");
      }
    } catch (e) {
      console.warn("[work-service] Seed shift data lỗi:", e.message);
    }
  } else {
    if (memoryTemplates.length === 0) {
      memoryTemplates = [
        { id: "st-1", name: "Ca Sáng", startTime: "07:00", endTime: "14:00" },
        { id: "st-2", name: "Ca Chiều", startTime: "14:00", endTime: "22:00" },
        { id: "st-3", name: "Ca Tối", startTime: "18:00", endTime: "23:00" },
      ];
    }
  }
  return { mode: prisma ? "postgres" : "memory" };
}

// --- Shifts ---
async function listShifts(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.branchSlug) where.branchSlug = query.branchSlug;
      if (query.employeeId) where.employeeId = query.employeeId;
      // Lọc/sắp xếp theo khóa YYYYMMDD để đúng cả với dữ liệu cũ (ISO/DD-MM-YYYY)
      // trước khi migration, và đúng thứ tự ngày khi cột lưu DD/MM/YYYY.
      const dateFilter = query.date ? dateKey(query.date) : "";
      const rows = await prisma.shift.findMany({ where });
      const filtered = dateFilter ? rows.filter((s) => dateKey(s.date) === dateFilter) : rows;
      return await markMissedShifts(filtered.sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date))));
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shift.findMany:", err);
      throw new InternalServerError("Không đọc được danh sách ca làm việc từ CSDL", err);
    }
  }
  const dateFilter = query.date ? dateKey(query.date) : "";
  const rows = memoryShifts
    .filter((s) => {
      if (query.branchSlug && s.branchSlug !== query.branchSlug) return false;
      if (query.employeeId && s.employeeId !== query.employeeId) return false;
      if (dateFilter && dateKey(s.date) !== dateFilter) return false;
      return true;
    })
    .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
  return markMissedShifts(rows);
}

async function nextShiftId() {
  const prisma = database.getPrisma();
  let max = 0;
  const prefix = "CA-";
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  if (prisma) {
    const rows = await prisma.shift
      .findMany({ where: { id: { startsWith: prefix } }, select: { id: true } })
      .catch(() => []);
    rows.forEach((r) => scan(r.id));
  } else {
    memoryShifts.forEach((s) => scan(s.id));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function nextTaskId() {
  const prisma = database.getPrisma();
  let max = 0;
  const prefix = "CV-";
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  if (prisma) {
    const rows = await prisma.task
      .findMany({ where: { id: { startsWith: prefix } }, select: { id: true } })
      .catch(() => []);
    rows.forEach((r) => scan(r.id));
  } else {
    memoryTasks.forEach((t) => scan(t.id));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function createShift(payload) {
  const data = sanitizeShiftPayload(payload);
  if (!data.id) {
    data.id = await nextShiftId();
  }
  if (!data.status) {
    data.status = "Chưa chấm công";
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shift.create({ data });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shift.create:", err);
      // Prisma có thật mà ghi hỏng: phải ném lên controller để client nhận 5xx.
      // Rơi xuống memory sẽ trả 2xx cho bản ghi không nằm trong DB và biến mất
      // ở lần listShifts kế tiếp (list chỉ đọc memory khi Prisma bằng null).
      throw err;
    }
  }
  const row = { status: "Chưa chấm công", ...data };
  memoryShifts.push(row);
  return row;
}

async function updateShift(id, payload) {
  const data = sanitizeShiftPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shift.update({ where: { id }, data });
    } catch (err) {
      // P2025 = không có dòng để sửa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return null;
      console.error("[work-service] Lỗi prisma.shift.update:", err);
      throw err;
    }
  }
  const idx = memoryShifts.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  memoryShifts[idx] = { ...memoryShifts[idx], ...data };
  return memoryShifts[idx];
}

async function deleteShift(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.shift.delete({ where: { id } });
      return true;
    } catch (err) {
      // P2025 = không có dòng để xóa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return false;
      console.error("[work-service] Lỗi prisma.shift.delete:", err);
      throw err;
    }
  }
  const idx = memoryShifts.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  memoryShifts.splice(idx, 1);
  return true;
}

async function registerShift(payload) {
  const rawWeek = payload.week || payload.preference || null;
  // `week` có thể là ngày cụ thể hoặc khóa thứ (T2..CN); chỉ chuẩn hóa khi là ngày.
  const week = rawWeek === null ? null : toVnDate(rawWeek) || rawWeek;
  const shiftId = payload.shiftId || null;

  // Nếu shiftId là 'off', hủy tất cả đăng ký ca của nhân viên trong ngày/tuần đó
  if (shiftId === "off") {
    await unregisterShift({ employeeId: payload.employeeId, week });
    return { ok: true, unregistered: true };
  }

  const data = {
    employeeId: payload.employeeId,
    branchSlug: payload.branchSlug || null,
    week,
    shiftId,
  };
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      // Tránh trùng lặp nếu đã đăng ký ca này vào ngày này rồi
      const existing = await prisma.shiftRegistration.findFirst({
        where: {
          employeeId: data.employeeId,
          week: data.week,
          shiftId: data.shiftId,
        },
      });
      if (existing) {
        return existing;
      }
      return await prisma.shiftRegistration.create({ data });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shiftRegistration.create:", err);
      // Như createShift: lỗi đăng ký ca phải ném ra, không được trả bản ghi memory.
      throw err;
    }
  }
  const existingMem = memoryRegistrations.find(
    (r) => r.employeeId === data.employeeId && r.week === data.week && r.shiftId === data.shiftId
  );
  if (existingMem) return existingMem;
  const row = { id: uid("reg"), ...data };
  memoryRegistrations.push(row);
  return row;
}

async function unregisterShift({ employeeId, shiftId, week: rawWeek }) {
  const week = rawWeek ? toVnDate(rawWeek) || rawWeek : rawWeek;
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (employeeId) where.employeeId = employeeId;
      if (shiftId && shiftId !== "all" && shiftId !== "off") where.shiftId = shiftId;
      if (week) where.week = week;
      const result = await prisma.shiftRegistration.deleteMany({ where });
      return result.count > 0;
    } catch (err) {
      // deleteMany không ném P2025: count=0 mới là "không có dòng nào", còn lỗi ở đây
      // là lỗi DB thật và phải ném lên 500 thay vì trả 200 như đã hủy ca.
      console.error("[work-service] Lỗi unregisterShift:", err);
      throw err;
    }
  }
  const beforeLen = memoryRegistrations.length;
  memoryRegistrations = memoryRegistrations.filter((r) => {
    if (employeeId && r.employeeId !== employeeId) return true;
    if (week && r.week !== week) return true;
    if (shiftId && shiftId !== "all" && shiftId !== "off" && r.shiftId !== shiftId) return true;
    return false;
  });
  return memoryRegistrations.length < beforeLen;
}

async function listRegistrations(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.branchSlug) where.branchSlug = query.branchSlug;
      if (query.week) where.week = query.week;
      if (query.employeeId) where.employeeId = query.employeeId;
      return await prisma.shiftRegistration.findMany({ where, orderBy: { createdAt: "desc" } });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shiftRegistration.findMany:", err);
      throw new InternalServerError("Không đọc được đăng ký ca từ CSDL", err);
    }
  }
  return memoryRegistrations.filter((r) => {
    if (query.branchSlug && r.branchSlug !== query.branchSlug) return false;
    if (query.week && r.week !== query.week) return false;
    if (query.employeeId && r.employeeId !== query.employeeId) return false;
    return true;
  });
}

async function deleteRegistration(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.shiftRegistration.delete({ where: { id } });
      return true;
    } catch (err) {
      // P2025 = không có dòng để xóa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return false;
      console.error("[work-service] Lỗi prisma.shiftRegistration.delete:", err);
      throw err;
    }
  }
  const idx = memoryRegistrations.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  memoryRegistrations.splice(idx, 1);
  return true;
}

// --- Attendance ---
function minutesOf(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Hạn chốt ra = giờ kết thúc ca + checkoutWindowMinutes, cùng cách app đang nhắc
// "quên check-out sau 10/30/60 phút". Không tính từ giờ vào ca vì ca 8 tiếng sẽ
// bị bỏ qua ngay khi nhân viên còn đang làm.
function missedByWindow(row, shift, windowMin, now) {
  if (!windowMin || !row || row.checkOut || !row.checkIn) return false;
  const endMin = minutesOf(shift && shift.scheduledEnd);
  const day = parseDate((shift && shift.date) || row.date);
  if (endMin === null || !day) return false;
  const deadline = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(endMin / 60),
    (endMin % 60) + windowMin
  );
  return now > deadline.getTime();
}

async function getShiftForWindow(prisma, shiftId) {
  if (!shiftId) return null;
  if (prisma) return prisma.shift.findUnique({ where: { id: shiftId } });
  return memoryShifts.find((s) => s.id === shiftId) || null;
}

// Bỏ qua ca chỉ được tính khi đọc, không cần cron.
// onMissed(row, ref) chỉ chạy khi bản ghi THẬT SỰ bước sang trạng thái missed
// (trạng thái đã lưu chưa phải "missed"), đó là chỗ để ghi + thông báo một lần.
// Bản ghi đã lưu "missed" thì chỉ chiếu trạng thái, không ghi và không báo lại.
async function markMissedRows(rows, refFor, onMissed) {
  if (!rows.some((r) => r.checkIn && !r.checkOut)) return rows;
  const cfg = await getConfig();
  const windowMin = Number(cfg.checkoutWindowMinutes || 0);
  if (!windowMin) return rows;
  const now = Date.now();
  const out = [];
  for (const r of rows) {
    const ref = r.checkIn && !r.checkOut ? await refFor(r) : null;
    if (missedByWindow(r, ref, windowMin, now)) {
      if (onMissed && r.status !== "missed") await onMissed(r, ref);
      out.push({ ...r, status: "missed" });
    } else {
      out.push(r);
    }
  }
  return out;
}

function markMissedShifts(rows) {
  return markMissedRows(rows, (s) => s);
}

// notify=false với luồng đọc nội bộ (payroll tính phạt khi lập phiếu lương): một
// lần GET không được nhân bản thành N lần ghi DB + N thông báo cho dữ liệu cũ.
function markMissedAttendance(rows, notify) {
  return markMissedRows(
    rows,
    (a) => getShiftForWindow(database.getPrisma(), a.shiftId),
    notify ? (a, shift) => rememberMissedAttendance(a, shift) : undefined
  );
}

// Ca bị bỏ qua phải đến tay admin/manager của chi nhánh: ghi status "missed" xuống
// đúng bản ghi chấm công (lần đọc sau không báo trùng) rồi gửi MỘT thông báo phạm
// vi chi nhánh. Lỗi gọi integration-service chỉ log và đọc vẫn trả dữ liệu; lỗi ghi
// DB thì để ném lên, vì đọc ghi hỏng ở đây là lỗi thật (RULES: không nuốt lỗi Prisma).
async function rememberMissedAttendance(row, shift) {
  const prisma = database.getPrisma();
  if (prisma) {
    await prisma.attendance.update({ where: { id: row.id }, data: { status: "missed" } });
  } else {
    row.status = "missed";
  }
  const dateLabel = toVnDate((shift && shift.date) || row.date) || row.date || "";
  const shiftLabel = (shift && shift.template) || row.shiftId || "không xác định";
  try {
    await IntegrationClient.createBranchNotification({
      // targetEmployeeId = null + branchSlug: manager chi nhánh đó và admin đều thấy.
      branchSlug: (shift && shift.branchSlug) || null,
      targetEmployeeId: null,
      title: `Nhân viên ${row.employeeId} chưa chốt ra, ca đã bị bỏ qua`,
      body:
        `Nhân viên ${row.employeeId} chưa chốt ra ca ${shiftLabel} ngày ${dateLabel} ` +
        `(quá cửa sổ chốt ra). Ca này bị bỏ qua nên không được tính giờ; ` +
        `vui lòng kiểm tra và chấm công ra cho nhân viên.`,
      shiftName: shiftLabel,
      shiftDate: dateLabel || null,
      metadata: { reason: "missed_checkout", employeeId: row.employeeId, shiftId: row.shiftId || null, date: dateLabel },
    });
  } catch (err) {
    console.warn("[work-service] Gửi thông báo ca bị bỏ qua thất bại:", err.message);
  }
}

// Quá cửa sổ chốt ra thì ca bị bỏ qua. Ba nhánh quyền, đúng chủ ý đã chốt:
// - Nhân viên: không tự chốt muộn, phải nhờ quản lý/admin (400).
// - Admin: chốt hộ mọi ca.
// - Manager: chỉ ca cùng chi nhánh; chi nhánh lấy từ header do gateway ký nên
//   branchSlug trong body/query không bao giờ được tin. Guard này là của tuyến
//   supplement cũ, chuyển sang đây khi tuyến đó bị xoá.
async function assertWithinCheckoutWindow(prisma, target, shiftId, windowMin, caller) {
  if (!windowMin || !target) return;
  const ref = await getShiftForWindow(prisma, target.shiftId || shiftId);
  if (!missedByWindow(target, ref, windowMin, Date.now())) return;
  if (!isPrivileged(caller || {})) {
    throw new ValidationError("Ca đã quá hạn chốt ra nên bị bỏ qua; bạn hãy liên hệ quản lý hoặc admin để chốt ca này");
  }
  if (caller.role === "manager" && String((ref && ref.branchSlug) || "") !== String(caller.branchSlug || "")) {
    throw new ForbiddenError("Bạn chỉ chốt được ca của chi nhánh mình quản lý");
  }
}

async function getConfig() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      let cfg = await prisma.attendanceConfig.findUnique({ where: { id: "default" } });
      if (!cfg) {
        cfg = await prisma.attendanceConfig.create({
          data: {
            id: "default",
            latePenaltyAmount: 20000,
            earlyLeavePenaltyAmount: 0,
            gracePeriodMinutes: 5,
            checkoutWindowMinutes: 60,
            autoCloseShift: false,
            shiftSwapMode: "manual",
            latePenaltyPct: 10,
            earlyLeavePenaltyPct: 10,
            earlyCheckinMinutes: 15,
            maxPenaltiesPerMonth: 10,
            deductOnCheckout: true,
            allowDoubleCheckin: true,
            maxCheckinsPerDay: 3,
            maxSwapsPerMonth: 3,
            requireReasonSwap: true,
          },
        });
      }
      memoryConfig = { ...memoryConfig, ...cfg };
      return cfg;
    } catch (err) {
      console.error("[work-service] Lỗi getConfig từ DB:", err);
      throw new InternalServerError("Không đọc được cấu hình chấm công từ CSDL", err);
    }
  }
  return memoryConfig;
}

async function updateConfig(payload) {
  const data = sanitizeAttendanceConfigPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const res = await prisma.attendanceConfig.upsert({
        where: { id: "default" },
        create: { id: "default", ...data },
        update: data,
      });
      memoryConfig = { ...memoryConfig, ...res };
      return res;
    } catch (err) {
      console.error("[work-service] Lỗi prisma.attendanceConfig.upsert:", err);
      // upsert trên id "default" không có nghĩa "thiếu dòng": đây là lỗi ghi thật,
      // ném lên 500 thay vì trả 200 kèm cấu hình chỉ tồn tại trong bộ nhớ.
      throw err;
    }
  }
  memoryConfig = { ...memoryConfig, ...data };
  return memoryConfig;
}

async function syncShiftCheckin(prisma, employeeId, shiftId, checkInTime) {
  // Trả về ca vừa tìm được để checkin đối chiếu giờ bắt đầu ca mà không phải
  // query lại shift lần hai.
  let resolved = null;
  if (prisma) {
    try {
      let shift = null;
      if (shiftId) {
        shift = await prisma.shift.findUnique({ where: { id: shiftId } }).catch(() => null);
      }
      if (!shift && employeeId) {
        const today = todayVn();
        const shifts = await prisma.shift.findMany({ where: { employeeId } }).catch(() => []);
        shift = shifts.find((s) => dateKey(s.date) === dateKey(today)) || null;
      }
      if (shift) {
        // Ca phải thuộc đúng nhân viên đang chấm công, nếu không thì một ca
        // của người khác có thể bị ghi giờ vào/ra từ xa. Dữ liệu ca luôn có
        // employeeId; dòng không có employeeId là dữ liệu cũ nên bỏ qua.
        if (shift.employeeId && String(shift.employeeId) !== String(employeeId)) {
          throw new ForbiddenError("Ca làm việc không thuộc nhân viên này");
        }
        resolved = shift;
        await prisma.shift.update({
          where: { id: shift.id },
          data: { checkIn: checkInTime, status: "đang làm" },
        });
      }
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      console.error("[work-service] Lỗi đồng bộ ca làm khi checkin (prisma):", err);
    }
  }

  let memShift = null;
  if (shiftId) {
    memShift = memoryShifts.find((s) => s.id === shiftId);
  }
  if (!memShift && employeeId) {
    const today = todayVn();
    memShift = memoryShifts.find((s) => s.employeeId === employeeId && dateKey(s.date) === dateKey(today));
  }
  if (memShift) {
    if (memShift.employeeId && String(memShift.employeeId) !== String(employeeId)) {
      throw new ForbiddenError("Ca làm việc không thuộc nhân viên này");
    }
    memShift.checkIn = checkInTime;
    memShift.status = "đang làm";
    resolved = resolved || memShift;
  }
  return resolved;
}

async function syncShiftCheckout(prisma, employeeId, shiftId, checkOutTime) {
  if (prisma) {
    try {
      let shift = null;
      if (shiftId) {
        shift = await prisma.shift.findUnique({ where: { id: shiftId } }).catch(() => null);
      }
      if (!shift && employeeId) {
        const today = todayVn();
        const shifts = await prisma.shift.findMany({ where: { employeeId } }).catch(() => []);
        shift = shifts.find((s) => dateKey(s.date) === dateKey(today)) || null;
      }
      if (shift) {
        if (shift.employeeId && String(shift.employeeId) !== String(employeeId)) {
          throw new ForbiddenError("Ca làm việc không thuộc nhân viên này");
        }
        await prisma.shift.update({
          where: { id: shift.id },
          data: { checkOut: checkOutTime, status: "hoàn thành" },
        });
      }
    } catch (err) {
      if (err instanceof ForbiddenError) throw err;
      console.error("[work-service] Lỗi đồng bộ ca làm khi checkout (prisma):", err);
    }
  }

  let memShift = null;
  if (shiftId) {
    memShift = memoryShifts.find((s) => s.id === shiftId);
  }
  if (!memShift && employeeId) {
    const today = todayVn();
    memShift = memoryShifts.find((s) => s.employeeId === employeeId && dateKey(s.date) === dateKey(today));
  }
  if (memShift) {
    if (memShift.employeeId && String(memShift.employeeId) !== String(employeeId)) {
      throw new ForbiddenError("Ca làm việc không thuộc nhân viên này");
    }
    memShift.checkOut = checkOutTime;
    memShift.status = "hoàn thành";
  }
}

async function checkin({ employeeId, shiftId, time, checkinTime }) {
  const cfg = await getConfig();
  const now = new Date();
  const effectiveTime = time || checkinTime || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const prisma = database.getPrisma();
  const shift = await syncShiftCheckin(prisma, employeeId, shiftId, effectiveTime);
  // Phạt đi muộn: giờ chấm công trễ hơn (giờ bắt đầu ca + thời gian cho phép trễ).
  // Không tìm được ca trong ngày thì không có giờ chuẩn, nên không phạt.
  const startMin = minutesOf(shift && shift.scheduledStart);
  const inMin = minutesOf(effectiveTime);
  const lateMinutes =
    startMin === null || inMin === null ? 0 : inMin - (startMin + (cfg.gracePeriodMinutes || 0));
  const isLate = lateMinutes > 0 && (cfg.latePenaltyAmount || 0) > 0;
  const row = {
    id: uid("att"),
    employeeId,
    shiftId: shiftId || null,
    date: todayVn(),
    checkIn: effectiveTime,
    checkOut: null,
    penaltyAmount: isLate ? cfg.latePenaltyAmount : 0,
    penaltyNote: isLate ? `Đi muộn ${lateMinutes} phút so với ca ${shift.scheduledStart}` : null,
    status: isLate ? "late" : "present",
  };
  if (prisma) {
    try {
      return await prisma.attendance.create({ data: row });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.attendance.create:", err);
      // Chấm công vào không ghi được DB thì phải báo lỗi thật; bản ghi memory
      // sẽ mất ngay ở lần listAttendance tiếp theo vì list không gộp memory.
      throw err;
    }
  }
  memoryAttendances.push(row);
  return row;
}

// `caller` là danh tính controller đọc từ header do gateway ký (userId/role/branchSlug).
// Chỉ nhân viên tự chốt ra muộn mới bị chặn; admin/manager chốt hộ ca đã bị bỏ qua
// bằng chính tuyến POST /api/attendance/checkout, không có endpoint riêng.
async function checkout({ employeeId, shiftId, time, checkoutTime, caller }) {
  const cfg = await getConfig();
  const windowMin = Number(cfg.checkoutWindowMinutes || 0);
  const prisma = database.getPrisma();
  const now = new Date();
  const serverTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const out = time || checkoutTime || serverTime;
  // Ưu tiên bản ghi mở của HÔM NAY. Trước đây chỉ cần "bản ghi mở gần nhất" nên
  // một lần chốt hôm nay có thể đóng nhầm ca còn mở của tuần trước. Vẫn giữ
  // nhánh fallback vì Ca Tối trải qua nửa đêm: sáng hôm sau chốt ra là hợp lệ.
  const today = dateKey(todayVn());
  // shiftId là ô bắt buộc khi admin/manager chốt hộ một ca cụ thể: nếu chỉ
  // "bản ghi mở gần nhất" thì lần chốt hộ ca bị bỏ qua hôm trước lại đóng nhầm
  // bản ghi đang mở của hôm nay. Không có shiftId (nhân viên tự chốt) thì giữ
  // nguyên luật cũ, kể cả nhánh fallback cho Ca Tối trải qua nửa đêm.
  const pickOpen = (list) =>
    (shiftId ? list.find((r) => !r.checkOut && String(r.shiftId || "") === String(shiftId)) : null) ||
    list.find((r) => !r.checkOut && dateKey(r.date) === today) ||
    list.find((r) => !r.checkOut) ||
    null;
  let target = null;
  if (prisma) {
    try {
      const rows = await prisma.attendance.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
      target = pickOpen(rows);
      if (target) {
        await assertWithinCheckoutWindow(prisma, target, shiftId, windowMin, caller);
        // Chỉ đồng bộ ca khi chắc chắn chốt được: nếu làm trước, ca bị đánh dấu
        // "hoàn thành" trong khi bản ghi chấm công vẫn mở và request trả lỗi.
        await syncShiftCheckout(prisma, employeeId, shiftId, out);
        // Phần phạt đi muộn đã ghi khi chấm công phải sống sót qua lần chốt ra:
        // trước đây penaltyAmount bị ghi đè nên nhân viên vừa trễ vừa về sớm chỉ bị
        // tính một lần, và status "present" ghi đè mất nhãn "late".
        const latePart = Number(target.penaltyAmount || 0);
        // Bản ghi từng bị "missed" (lưu khi quá cửa sổ) được quản lý/admin chốt hộ
        // thì phải trở lại trạng thái được ghi công; nhãn "late" lấy lại theo phần
        // phạt đã ghi vì status cũ đã bị missed đè lên.
        let penalty = latePart;
        let status = target.status === "missed" ? (latePart > 0 ? "late" : "present") : target.status || "present";
        const outMin = minutesOf(out);
        if (outMin !== null && outMin < 17 * 60) {
          penalty = latePart + (cfg.earlyLeavePenaltyAmount || 0);
          status = "early_leave";
        }
        return await prisma.attendance.update({ where: { id: target.id }, data: { checkOut: out, penaltyAmount: penalty, status } });
      }
    } catch (err) {
      // Lỗi nghiệp vụ (400/403/404) ném từ trong nhánh này không phải lỗi DB.
      if (err.status && err.status < 500) throw err;
      console.error("[work-service] Lỗi prisma.attendance.checkout:", err);
      // Nhánh này trước đây rơi xuống memory và còn tự gọi lại checkin(),
      // tạo bản ghi "thành công" chỉ có trong bộ nhớ. Ném lỗi thật lên controller.
      throw err;
    }
    // Prisma sống nhưng hết hàm try là chưa có bản ghi mở để chốt (nhánh trên đã return).
    // Phải trả lỗi thật: trước đây code rơi xuống memory rồi checkin() hộ, client nhận
    // 200 kèm checkOut chưa từng được ghi vào DB.
    throw new NotFoundError("Không tìm thấy bản ghi chấm công đang mở để chốt ra");
  }
  target = pickOpen([...memoryAttendances].reverse().filter((r) => r.employeeId === employeeId));
  await assertWithinCheckoutWindow(null, target, shiftId, windowMin, caller);
  await syncShiftCheckout(prisma, employeeId, shiftId, out);
  if (!target) {
    const ci = await checkin({ employeeId, shiftId, time: "08:00" });
    target = ci;
  }
  const latePart = Number(target.penaltyAmount || 0);
  let penalty = latePart;
  // Như nhánh Prisma: chốt hộ thì bản ghi "missed" quay lại trạng thái ghi công.
  let status = target.status === "missed" ? (latePart > 0 ? "late" : "present") : target.status || "present";
  const outMin = minutesOf(out);
  if (outMin !== null && outMin < 17 * 60) {
    penalty = latePart + (cfg.earlyLeavePenaltyAmount || 0);
    status = "early_leave";
  }
  target.checkOut = out;
  target.penaltyAmount = penalty;
  target.status = status;
  return target;
}

async function listAttendance(query = {}) {
  // query.actor do controller gắn từ header x-user-id do gateway ký: null nghĩa là
  // luồng nội bộ (payroll đọc phạt khi lập phiếu lương) — chỉ chiếu trạng thái,
  // không ghi DB và không bắn thông báo, để một lần GET không nhân bản thành N hiệu ứng.
  const notify = query.actor !== null;
  const prisma = database.getPrisma();
  const dateFilter = query.date ? dateKey(query.date) : "";
  const monthFilter = query.month ? monthKey(query.month) : null;
  const matchDate = (a) =>
    (!dateFilter || dateKey(a.date) === dateFilter) &&
    (!monthFilter || dateKey(a.date).slice(0, 6) === `${monthFilter.yy}${monthFilter.mon}`);
  if (prisma) {
    try {
      let rows;
      if (query.branchSlug) {
        // attendance không lưu branchSlug: lọc theo shift
        const shifts = await prisma.shift.findMany({ where: { branchSlug: query.branchSlug } });
        const ids = new Set(shifts.map((s) => s.id));
        const all = await prisma.attendance.findMany({ orderBy: { createdAt: "desc" } });
        rows = all.filter(
          (a) =>
            (query.employeeId ? a.employeeId === query.employeeId : true) &&
            (a.shiftId ? ids.has(a.shiftId) : false)
        );
      } else {
        const where = {};
        if (query.employeeId) where.employeeId = query.employeeId;
        rows = await prisma.attendance.findMany({ where, orderBy: { createdAt: "desc" } });
      }
      // Chấp nhận month=YYYY-MM hoặc MM/YYYY, so theo khóa YYYYMMDD.
      // checkOut của bản ghi missed vẫn null: client không tính được giờ công,
      // đó là cách "ca không được ghi công" biểu diễn bằng dữ liệu.
      return await markMissedAttendance(rows.filter(matchDate), notify);
    } catch (err) {
      console.error("[work-service] Lỗi prisma.attendance.list:", err);
      throw new InternalServerError("Không đọc được dữ liệu chấm công từ CSDL", err);
    }
  }
  let out = [...memoryAttendances];
  if (query.employeeId) out = out.filter((a) => a.employeeId === query.employeeId);
  return markMissedAttendance(out.filter(matchDate), notify);
}

// --- Tasks ---
async function listTasks(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.branchSlug) {
        where.branchSlug = { equals: query.branchSlug, mode: "insensitive" };
      }
      if (query.status) where.status = query.status;
      if (query.includeShiftTasksOfBranch) {
        // Nhiệm vụ giao riêng cho tôi + nhiệm vụ theo ca của chi nhánh tôi
        // (nhiệm vụ theo ca không có một người nhận cụ thể).
        where.OR = [
          { assignedTo: query.assignedTo },
          {
            assignedTo: null,
            sourceType: "shift",
            branchSlug: { equals: query.includeShiftTasksOfBranch, mode: "insensitive" },
          },
        ];
      } else if (query.assignedTo) {
        where.assignedTo = query.assignedTo;
      }
      return await prisma.task.findMany({ where, orderBy: { createdAt: "desc" } });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.task.findMany:", err);
      throw new InternalServerError("Không đọc được danh sách tác vụ từ CSDL", err);
    }
  }
  return memoryTasks.filter((t) => {
    if (query.branchSlug && (t.branchSlug || "").toLowerCase() !== query.branchSlug.toLowerCase()) return false;
    if (query.status && t.status !== query.status) return false;
    if (query.includeShiftTasksOfBranch) {
      const mine = query.assignedTo && t.assignedTo === query.assignedTo;
      const shiftTask =
        !t.assignedTo &&
        t.sourceType === "shift" &&
        (t.branchSlug || "").toLowerCase() === String(query.includeShiftTasksOfBranch).toLowerCase();
      if (!mine && !shiftTask) return false;
    } else if (query.assignedTo && t.assignedTo !== query.assignedTo) {
      return false;
    }
    return true;
  });
}

async function createTask(payload) {
  const data = sanitizeTaskPayload(payload);
  if (!data.id) {
    data.id = await nextTaskId();
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.task.create({ data });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.task.create:", err);
      // Như createShift: nhiệm vụ chỉ nằm trong memory sẽ mất khi tải lại,
      // trong khi client đã nhận 201. Ném lỗi DB lên controller.
      throw err;
    }
  }
  const row = { status: "pending", ...data };
  memoryTasks.push(row);
  return row;
}

async function updateTask(id, payload) {
  const data = sanitizeTaskPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.task.update({ where: { id }, data });
    } catch (err) {
      // P2025 = không có dòng để sửa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return null;
      console.error("[work-service] Lỗi prisma.task.update:", err);
      throw err;
    }
  }
  const idx = memoryTasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  memoryTasks[idx] = { ...memoryTasks[idx], ...data };
  return memoryTasks[idx];
}

async function deleteTask(id) {
  const task = await getTaskById(id);
  if (!task) return false;
  const prisma = database.getPrisma();
  let deleted = false;
  if (prisma) {
    try {
      await prisma.task.delete({ where: { id } });
      deleted = true;
    } catch (err) {
      // P2025 = không có dòng để xóa -> 404; lỗi DB khác phải ném lên 500,
      // nếu rơi xuống memory sẽ xóa nhầm bản trùng id trong bộ nhớ và vẫn báo thành công.
      if (String(err.code) === "P2025") return false;
      console.error("[work-service] Lỗi prisma.task.delete:", err);
      throw err;
    }
  }
  if (!deleted) {
    const idx = memoryTasks.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    memoryTasks.splice(idx, 1);
  }
  // Xóa ảnh minh chứng best-effort, không chặn thao tác xóa nhiệm vụ.
  if (task.proofPhotoUrl) {
    IntegrationClient.deleteFileByUrl(task.proofPhotoUrl).catch((e) => {
      console.warn("[work-service] Xóa ảnh minh chứng thất bại:", e.message);
    });
  }
  return true;
}

async function getShiftById(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.shift.findUnique({ where: { id } });
      if (row) return (await markMissedShifts([row]))[0];
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shift.findUnique:", err);
      throw new InternalServerError("Không đọc được ca làm việc từ CSDL", err);
    }
  }
  const row = memoryShifts.find((s) => s.id === id) || null;
  if (!row) return null;
  return (await markMissedShifts([row]))[0];
}

async function getTaskById(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.task.findUnique({ where: { id } });
      if (row) return row;
    } catch (err) {
      console.error("[work-service] Lỗi prisma.task.findUnique:", err);
      throw new InternalServerError("Không đọc được tác vụ từ CSDL", err);
    }
  }
  return memoryTasks.find((t) => t.id === id) || null;
}

async function listTemplates() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.findMany({ orderBy: { createdAt: "asc" } });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shiftTemplate.findMany:", err);
      throw new InternalServerError("Không đọc được khung ca mẫu từ CSDL", err);
    }
  }
  return memoryTemplates;
}

async function createTemplate(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.create({ data: payload });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shiftTemplate.create:", err);
      // listTemplates chỉ đọc memoryTemplates khi Prisma bằng null, nên khung ca
      // rơi xuống memory sẽ biến mất ngay. Phải ném lỗi ghi DB.
      throw err;
    }
  }
  const row = { id: uid("st"), ...payload };
  memoryTemplates.push(row);
  return row;
}

async function updateTemplate(id, payload) {
  // Chỉ nhận field đã biết: client gửi field lạ sẽ làm Prisma lỗi 500.
  const data = {};
  for (const k of ["name", "startTime", "endTime"]) {
    if (payload[k] !== undefined) data[k] = payload[k];
  }
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.update({ where: { id }, data });
    } catch (err) {
      // P2025 = không có dòng để sửa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return null;
      console.error("[work-service] Lỗi prisma.shiftTemplate.update:", err);
      throw err;
    }
  }
  const idx = memoryTemplates.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  memoryTemplates[idx] = { ...memoryTemplates[idx], ...data };
  return memoryTemplates[idx];
}

async function deleteTemplate(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.shiftTemplate.delete({ where: { id } });
      return true;
    } catch (err) {
      // P2025 = không có dòng để xóa -> 404; lỗi DB khác phải ném lên 500.
      if (String(err.code) === "P2025") return false;
      console.error("[work-service] Lỗi prisma.shiftTemplate.delete:", err);
      throw err;
    }
  }
  const idx = memoryTemplates.findIndex((t) => t.id === id);
  if (idx < 0) return false;
  memoryTemplates.splice(idx, 1);
  return true;
}

module.exports = {
  ensureSeeded,
  listShifts,
  createShift,
  updateShift,
  deleteShift,
  registerShift,
  unregisterShift,
  listRegistrations,
  deleteRegistration,
  getShiftById,
  getConfig,
  updateConfig,
  checkin,
  checkout,
  listAttendance,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskById,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
