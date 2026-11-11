"use strict";

const database = require("../config/database");
const { SEED_NOTIFICATIONS } = require("../../prisma/seed");

let memoryNotifications = JSON.parse(JSON.stringify(SEED_NOTIFICATIONS)).map((n) => ({
  ...n,
  createdAt: new Date(),
}));

// Ba loại thông báo, phân biệt bằng (targetEmployeeId, branchSlug):
// - Đích danh (targetEmployeeId != null): chỉ người đó xem/thao tác được.
// - Broadcast thật (cả hai null): mọi người đều thấy.
// - Phạm vi chi nhánh (target null, branchSlug != null): chỉ quản lý chi nhánh đó
//   và admin xem chéo thấy. Nhân viên thường KHÔNG được thấy, kể cả cùng chi
//   nhánh, vì loại này chứa danh tính người khác (ví dụ "NV X quên chốt ra").
// Caller có thể mang cả employeeId lẫn branchSlug (manager/admin), nên phải xét
// cả hai thay vì nhánh đầu tiên thắng.
function matchesVisibility(n, { employeeId, branchSlug, allBranches } = {}) {
  if (n.targetEmployeeId) return n.targetEmployeeId === employeeId;
  if (!n.branchSlug) return true;
  return Boolean(branchSlug) ? n.branchSlug === branchSlug : Boolean(allBranches);
}

function visibilityWhere({ employeeId, branchSlug, allBranches } = {}) {
  const or = [{ targetEmployeeId: null, branchSlug: null }];
  if (employeeId) or.push({ targetEmployeeId: employeeId });
  if (branchSlug) or.push({ targetEmployeeId: null, branchSlug });
  else if (allBranches) or.push({ targetEmployeeId: null, branchSlug: { not: null } });
  return { OR: or };
}

async function findMany(scope = {}) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryNotifications.filter((n) => matchesVisibility(n, scope));
  }
  return prisma.notification.findMany({
    where: visibilityWhere(scope),
    orderBy: { createdAt: "desc" },
  });
}

async function findById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryNotifications.find((n) => n.id === id) || null;
  }
  return prisma.notification.findUnique({ where: { id } });
}

async function nextNotificationId() {
  const prisma = database.getPrisma();
  const prefix = "TB-";
  if (prisma) {
    try {
      const result = await prisma.$queryRaw`SELECT nextval('notification_id_seq') as val`;
      if (result && result.length > 0) {
        const val = Number(result[0].val);
        return `${prefix}${String(val).padStart(4, "0")}`;
      }
    } catch (err) {
      console.error("[integration-service] Lỗi nextval('notification_id_seq'):", err);
    }
  }

  let max = 0;
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  memoryNotifications.forEach((r) => scan(r.id));
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function create(data) {
  const prisma = database.getPrisma();
  if (!data.id) {
    data.id = await nextNotificationId();
  }
  if (!prisma) {
    const newNotif = {
      id: data.id,
      isRead: false,
      ...data,
      createdAt: new Date(),
    };
    memoryNotifications.unshift(newNotif);
    return newNotif;
  }
  return prisma.notification.create({ data });
}

async function markAsRead(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryNotifications.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    memoryNotifications[idx].isRead = true;
    return memoryNotifications[idx];
  }
  try {
    return await prisma.notification.update({ where: { id }, data: { isRead: true } });
  } catch (e) {
    // P2025: bản ghi không tồn tại -> controller trả 404 thay vì 500.
    if (e.code === "P2025") return null;
    throw e;
  }
}

// Đánh dấu tất cả thông báo trong phạm vi người dùng đang xem là đã đọc.
async function markAllAsRead({ employeeId, branchSlug } = {}) {
  if (!employeeId && !branchSlug) {
    const err = new Error("Thiếu employeeId hoặc branchSlug để đánh dấu đã đọc");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const prisma = database.getPrisma();
  if (!prisma) {
    let updated = 0;
    memoryNotifications.forEach((n) => {
      if (!n.isRead && matchesVisibility(n, { employeeId, branchSlug })) {
        n.isRead = true;
        updated += 1;
      }
    });
    return { updated };
  }
  const result = await prisma.notification.updateMany({
    where: { ...visibilityWhere({ employeeId, branchSlug }), isRead: false },
    data: { isRead: true },
  });
  return { updated: result.count };
}

async function deleteById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryNotifications.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    memoryNotifications.splice(idx, 1);
    return true;
  }
  await prisma.notification.delete({ where: { id } });
  return true;
}

let memorySettings = {};

const DEFAULT_SETTINGS = {
  checkInBefore1Hour: true,
  checkInBefore30Min: true,
  checkInBefore10Min: true,
  checkOutBefore10Min: true,
  missedCheckOutAfter10Min: true,
  missedCheckOutAfter30Min: true,
  missedCheckOutAfter1Hour: true,
  tabNotificationAlert: true,
  soundEnabled: true,
  vibrateEnabled: true,
};

// Chỉ nhận đúng các khóa boolean đã biết, bỏ qua field lạ client gửi lên.
function pickSettings(data = {}) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof data[key] === "boolean") out[key] = data[key];
  }
  return out;
}

async function getSettings(userId) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return { ...DEFAULT_SETTINGS, ...(memorySettings[userId] || {}) };
  }
  const row = await prisma.notificationSetting.findUnique({ where: { id: userId } });
  return { ...DEFAULT_SETTINGS, ...pickSettings(row || {}) };
}

async function updateSettings(userId, data) {
  const patch = pickSettings(data);
  const prisma = database.getPrisma();
  if (!prisma) {
    memorySettings[userId] = { ...(memorySettings[userId] || {}), ...patch };
    return { ...DEFAULT_SETTINGS, ...memorySettings[userId] };
  }
  const row = await prisma.notificationSetting.upsert({
    where: { id: userId },
    create: { id: userId, ...patch },
    update: patch,
  });
  return { ...DEFAULT_SETTINGS, ...pickSettings(row) };
}

module.exports = {
  findMany,
  findById,
  matchesVisibility,
  create,
  markAsRead,
  markAllAsRead,
  deleteById,
  getSettings,
  updateSettings,
  nextNotificationId,
};
