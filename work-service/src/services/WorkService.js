"use strict";

const database = require("../config/database");

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const seedShifts = [];
const seedTasks = [];
let memoryShifts = [];
let memoryAttendances = [];
let memoryTasks = [];
let memoryRegistrations = [];
let memoryConfig = { id: "default", latePenaltyAmount: 20000, earlyLeavePenaltyAmount: 0, gracePeriodMinutes: 5, autoCloseShift: false, shiftSwapMode: "manual", latePenaltyPct: 10, earlyLeavePenaltyPct: 10, earlyCheckinMinutes: 15, maxPenaltiesPerMonth: 10, deductOnCheckout: true, allowDoubleCheckin: true, maxCheckinsPerDay: 3, maxSwapsPerMonth: 3, requireReasonSwap: true };
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
  return cleaned;
}

function sanitizeAttendanceConfigPayload(payload = {}) {
  const allowed = [
    "latePenaltyAmount",
    "earlyLeavePenaltyAmount",
    "gracePeriodMinutes",
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
      if (query.date) where.date = query.date;
      return await prisma.shift.findMany({ where, orderBy: { date: "desc" } });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shift.findMany:", err);
    }
  }
  return memoryShifts.filter((s) => {
    if (query.branchSlug && s.branchSlug !== query.branchSlug) return false;
    if (query.employeeId && s.employeeId !== query.employeeId) return false;
    if (query.date && s.date !== query.date) return false;
    return true;
  });
}

async function createShift(payload) {
  const data = sanitizeShiftPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shift.create({ data });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.shift.create:", err);
    }
  }
  const row = { id: uid("sh"), status: "đang làm", ...data };
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
      console.error("[work-service] Lỗi prisma.shift.update:", err);
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
    } catch (_) {}
  }
  const idx = memoryShifts.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  memoryShifts.splice(idx, 1);
  return true;
}

async function registerShift(payload) {
  const week = payload.week || payload.preference || null;
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

async function unregisterShift({ employeeId, shiftId, week }) {
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
      console.error("[work-service] Lỗi unregisterShift:", err);
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
    } catch (_) {}
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
    }
  }
  memoryConfig = { ...memoryConfig, ...data };
  return memoryConfig;
}

async function checkin({ employeeId, shiftId, time }) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const row = {
    id: uid("att"),
    employeeId,
    shiftId: shiftId || null,
    date: `${dd}-${mm}-${yyyy}`,
    checkIn: time || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    checkOut: null,
    penaltyAmount: 0,
    penaltyNote: null,
    status: "present",
  };
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.attendance.create({ data: row });
    } catch (_) {}
  }
  memoryAttendances.push(row);
  return row;
}

async function checkout({ employeeId, shiftId, time }) {
  const cfg = await getConfig();
  const prisma = database.getPrisma();
  // Tìm bản ghi hôm nay chưa checkout
  let target = null;
  if (prisma) {
    try {
      const rows = await prisma.attendance.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
      target = rows.find((r) => !r.checkOut) || null;
      if (target) {
        const out = time || "17:30";
        // Phạt đơn giản: checkout rỗng -> về sớm nếu có giờ chuẩn? Giữ tối thiểu: không phạt khi đủ, phạt earlyLeave khi time < 17:00
        let penalty = 0;
        let status = "present";
        const outMin = minutesOf(out);
        if (outMin !== null && outMin < 17 * 60) {
          penalty = cfg.earlyLeavePenaltyAmount || 0;
          status = "early_leave";
        }
        return await prisma.attendance.update({ where: { id: target.id }, data: { checkOut: out, penaltyAmount: penalty, status } });
      }
    } catch (_) {}
  }
  target = [...memoryAttendances].reverse().find((r) => r.employeeId === employeeId && !r.checkOut) || null;
  const out = time || "17:30";
  if (!target) {
    const ci = await checkin({ employeeId, shiftId, time: "08:00" });
    target = ci;
  }
  let penalty = 0;
  let status = "present";
  const outMin = minutesOf(out);
  if (outMin !== null && outMin < 17 * 60) {
    penalty = cfg.earlyLeavePenaltyAmount || 0;
    status = "early_leave";
  }
  target.checkOut = out;
  target.penaltyAmount = penalty;
  target.status = status;
  return target;
}

async function listAttendance(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.employeeId) where.employeeId = query.employeeId;
      if (query.branchSlug) {
        // attendance không lưu branchSlug: lọc theo shift
        const shifts = await prisma.shift.findMany({ where: { branchSlug: query.branchSlug } });
        const ids = new Set(shifts.map((s) => s.id));
        const all = await prisma.attendance.findMany({ orderBy: { createdAt: "desc" } });
        let out = all.filter((a) => (query.employeeId ? a.employeeId === query.employeeId : true));
        if (query.date) out = out.filter((a) => a.date === query.date);
        if (query.branchSlug) out = out.filter((a) => (a.shiftId ? ids.has(a.shiftId) : false));
        // month=YYYY-MM -> lọc theo date DD-MM-YYYY
        if (query.month) {
          const [yy, mon] = query.month.split("-");
          out = out.filter((a) => {
            const parts = a.date.split("-");
            return parts[2] === yy && parts[1] === mon;
          });
        }
        return out;
      }
      let rows = await prisma.attendance.findMany({ where, orderBy: { createdAt: "desc" } });
      if (query.date) rows = rows.filter((a) => a.date === query.date);
      if (query.month) {
        const [yy, mon] = query.month.split("-");
        rows = rows.filter((a) => {
          const parts = a.date.split("-");
          return parts[2] === yy && parts[1] === mon;
        });
      }
      return rows;
    } catch (_) {}
  }
  let out = [...memoryAttendances];
  if (query.employeeId) out = out.filter((a) => a.employeeId === query.employeeId);
  if (query.date) out = out.filter((a) => a.date === query.date);
  if (query.month) {
    const [yy, mon] = query.month.split("-");
    out = out.filter((a) => {
      const parts = a.date.split("-");
      return parts[2] === yy && parts[1] === mon;
    });
  }
  return out;
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
      if (query.assignedTo) where.assignedTo = query.assignedTo;
      if (query.status) where.status = query.status;
      return await prisma.task.findMany({ where, orderBy: { createdAt: "desc" } });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.task.findMany:", err);
    }
  }
  return memoryTasks.filter((t) => {
    if (query.branchSlug && (t.branchSlug || "").toLowerCase() !== query.branchSlug.toLowerCase()) return false;
    if (query.assignedTo && t.assignedTo !== query.assignedTo) return false;
    if (query.status && t.status !== query.status) return false;
    return true;
  });
}

async function createTask(payload) {
  const data = sanitizeTaskPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.task.create({ data });
    } catch (err) {
      console.error("[work-service] Lỗi prisma.task.create:", err);
    }
  }
  const row = { id: uid("t"), status: "pending", ...data };
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
      console.error("[work-service] Lỗi prisma.task.update:", err);
    }
  }
  const idx = memoryTasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  memoryTasks[idx] = { ...memoryTasks[idx], ...data };
  return memoryTasks[idx];
}

async function deleteTask(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.task.delete({ where: { id } });
      return true;
    } catch (_) {}
  }
  const idx = memoryTasks.findIndex((t) => t.id === id);
  if (idx < 0) return false;
  memoryTasks.splice(idx, 1);
  return true;
}

async function getShiftById(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.shift.findUnique({ where: { id } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryShifts.find((s) => s.id === id) || null;
}

async function getTaskById(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.task.findUnique({ where: { id } });
      if (row) return row;
    } catch (_) {}
  }
  return memoryTasks.find((t) => t.id === id) || null;
}

async function listTemplates() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.findMany({ orderBy: { createdAt: "asc" } });
    } catch (_) {}
  }
  return memoryTemplates;
}

async function createTemplate(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.create({ data: payload });
    } catch (_) {}
  }
  const row = { id: uid("st"), ...payload };
  memoryTemplates.push(row);
  return row;
}

async function updateTemplate(id, payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftTemplate.update({ where: { id }, data: payload });
    } catch (_) {}
  }
  const idx = memoryTemplates.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  memoryTemplates[idx] = { ...memoryTemplates[idx], ...payload };
  return memoryTemplates[idx];
}

async function deleteTemplate(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.shiftTemplate.delete({ where: { id } });
      return true;
    } catch (_) {}
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
