"use strict";

const database = require("../config/database");
const { SEED_NOTIFICATIONS } = require("../../prisma/seed");

let memoryNotifications = JSON.parse(JSON.stringify(SEED_NOTIFICATIONS)).map((n) => ({
  ...n,
  createdAt: new Date(),
}));

// Phạm vi nhìn thấy thông báo (BUSINESS.md §7.2):
// - Có employeeId: chỉ broadcast (targetEmployeeId = null) + thông báo gửi đích danh mình.
//   Không lộ thông báo gửi riêng cho nhân viên khác cùng chi nhánh.
// - Chỉ có branchSlug (màn quản lý): broadcast + thông báo phạm vi chi nhánh đó.
// - Không tham số: chỉ broadcast.
function matchesVisibility(n, { employeeId, branchSlug } = {}) {
  if (employeeId) return !n.targetEmployeeId || n.targetEmployeeId === employeeId;
  if (branchSlug) return !n.targetEmployeeId || n.branchSlug === branchSlug;
  return !n.targetEmployeeId;
}

function visibilityWhere({ employeeId, branchSlug } = {}) {
  if (employeeId) {
    return { OR: [{ targetEmployeeId: null }, { targetEmployeeId: employeeId }] };
  }
  if (branchSlug) {
    return { OR: [{ targetEmployeeId: null }, { branchSlug }] };
  }
  return { OR: [{ targetEmployeeId: null }] };
}

async function findMany({ employeeId, branchSlug } = {}) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryNotifications.filter((n) => matchesVisibility(n, { employeeId, branchSlug }));
  }
  return prisma.notification.findMany({
    where: visibilityWhere({ employeeId, branchSlug }),
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

async function create(data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const newNotif = {
      id: data.id || `notif-${Date.now()}`,
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

async function getSettings(userId) {
  return memorySettings[userId] || {
    remindCheckIn: true,
    remindCheckOut: true,
    remindShift: true,
    notifyTask: true,
    notifyLeave: true,
  };
}

async function updateSettings(userId, data) {
  memorySettings[userId] = {
    ...(await getSettings(userId)),
    ...data,
  };
  return memorySettings[userId];
}

module.exports = {
  findMany,
  findById,
  create,
  markAsRead,
  markAllAsRead,
  deleteById,
  getSettings,
  updateSettings,
};
