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

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.shift.deleteMany({}).catch(() => {});
      await prisma.shiftRegistration.deleteMany({}).catch(() => {});
      await prisma.task.deleteMany({}).catch(() => {});
      await prisma.attendance.deleteMany({}).catch(() => {});
      await prisma.shiftTemplate.deleteMany({}).catch(() => {});
    } catch (_) {}
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
    } catch (_) {}
  }
  return memoryShifts.filter((s) => {
    if (query.branchSlug && s.branchSlug !== query.branchSlug) return false;
    if (query.employeeId && s.employeeId !== query.employeeId) return false;
    if (query.date && s.date !== query.date) return false;
    return true;
  });
}

async function createShift(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shift.create({ data: payload });
    } catch (_) {}
  }
  const row = { id: uid("sh"), status: "đang làm", ...payload };
  memoryShifts.push(row);
  return row;
}

async function updateShift(id, payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shift.update({ where: { id }, data: payload });
    } catch (_) {}
  }
  const idx = memoryShifts.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  memoryShifts[idx] = { ...memoryShifts[idx], ...payload };
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
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.shiftRegistration.create({ data: payload });
    } catch (_) {}
  }
  const row = { id: uid("reg"), ...payload };
  memoryRegistrations.push(row);
  return row;
}

async function listRegistrations(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.branchSlug) where.branchSlug = query.branchSlug;
      if (query.week) where.week = query.week;
      return await prisma.shiftRegistration.findMany({ where });
    } catch (_) {}
  }
  return memoryRegistrations.filter((r) => {
    if (query.branchSlug && r.branchSlug !== query.branchSlug) return false;
    if (query.week && r.week !== query.week) return false;
    return true;
  });
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
      const cfg = await prisma.attendanceConfig.findUnique({ where: { id: "default" } });
      if (cfg) return cfg;
    } catch (_) {}
  }
  return memoryConfig;
}

async function updateConfig(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.attendanceConfig.update({ where: { id: "default" }, data: payload });
    } catch (_) {}
  }
  memoryConfig = { ...memoryConfig, ...payload };
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
      if (query.branchSlug) where.branchSlug = query.branchSlug;
      if (query.assignedTo) where.assignedTo = query.assignedTo;
      if (query.status) where.status = query.status;
      return await prisma.task.findMany({ where, orderBy: { createdAt: "desc" } });
    } catch (_) {}
  }
  return memoryTasks.filter((t) => {
    if (query.branchSlug && t.branchSlug !== query.branchSlug) return false;
    if (query.assignedTo && t.assignedTo !== query.assignedTo) return false;
    if (query.status && t.status !== query.status) return false;
    return true;
  });
}

async function createTask(payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.task.create({ data: payload });
    } catch (_) {}
  }
  const row = { id: uid("t"), status: "pending", ...payload };
  memoryTasks.push(row);
  return row;
}

async function updateTask(id, payload) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.task.update({ where: { id }, data: payload });
    } catch (_) {}
  }
  const idx = memoryTasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  memoryTasks[idx] = { ...memoryTasks[idx], ...payload };
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
  listRegistrations,
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
