"use strict";

const database = require("../config/database");
const errorCodes = require("../utils/errors");

function serverError(message) {
  const err = new Error(message);
  err.status = 500;
  err.code = errorCodes.INTERNAL_SERVER_ERROR;
  return err;
}

// Nhật ký thao tác chỉ ghi việc thật. Bản ghi khởi tạo chỉ đánh dấu hệ thống
// vừa được dựng, không mô phỏng thao tác của người dùng (nhìn như nhật ký
// thật thì giả).
const INITIAL_BACKLOGS = [
  {
    id: "bl-init-1",
    timestamp: "04/11/2026 14:10:00",
    userName: "Hệ thống",
    userRole: "system",
    action: "CREATE",
    actionLabel: "Khởi tạo",
    module: "Hệ thống",
    targetName: "Khởi tạo dịch vụ",
    description: "Khởi tạo cấu hình và phân quyền hệ thống HRM",
  },
];

let memoryBacklogs = [...INITIAL_BACKLOGS];
let seededInDb = false;

function formatNow() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${d}/${m}/${y} ${h}:${mi}:${s}`;
}

async function ensureTableAndSeed(prisma) {
  if (seededInDb || !prisma) return;
  try {
    const count = await prisma.backlog.count();
    if (count === 0) {
      for (const item of INITIAL_BACKLOGS) {
        await prisma.backlog.create({
          data: {
            id: item.id,
            timestamp: item.timestamp,
            userName: item.userName,
            userRole: item.userRole || "staff",
            action: item.action,
            actionLabel: item.actionLabel,
            module: item.module,
            targetName: item.targetName,
            description: item.description || "",
          },
        }).catch(() => {});
      }
    }
    seededInDb = true;
  } catch (err) {
    console.warn("[BacklogService] ensureTableAndSeed warning:", err.message);
  }
}

async function list(query = {}) {
  const prisma = database.getPrisma();
  let items = [];

  if (prisma) {
    try {
      await ensureTableAndSeed(prisma);
      const rows = await prisma.backlog.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      items = rows || [];
    } catch (err) {
      // Postgres có thật mà lỗi thì phải báo lỗi: trả kho memory sẽ hiển thị
      // fixture (kể cả bản ghi chưa từng được ghi) như thể đó là nhật ký hệ thống.
      console.error("[BacklogService] query error:", err.message);
      throw serverError("Không đọc được nhật ký thao tác");
    }
  } else {
    items = [...memoryBacklogs];
  }

  // Lọc theo action
  if (query.action && query.action !== "all") {
    items = items.filter((it) => it.action === query.action);
  }

  // Lọc theo module
  if (query.module && query.module !== "all") {
    items = items.filter((it) => (it.module || "").toLowerCase() === query.module.toLowerCase());
  }

  // Tìm kiếm
  if (query.search) {
    const s = query.search.toLowerCase().trim();
    items = items.filter(
      (it) =>
        (it.targetName && it.targetName.toLowerCase().includes(s)) ||
        (it.userName && it.userName.toLowerCase().includes(s)) ||
        (it.description && it.description.toLowerCase().includes(s)) ||
        (it.module && it.module.toLowerCase().includes(s))
    );
  }

  return items;
}

async function create(data = {}) {
  const id = `bl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const timestamp = data.timestamp || formatNow();
  const entry = {
    id,
    timestamp,
    userName: data.userName || "Admin",
    userRole: data.userRole || "admin",
    action: data.action || "CREATE",
    actionLabel: data.actionLabel || "Thao tác",
    module: data.module || "Hệ thống",
    targetName: data.targetName || "Đối tượng",
    description: data.description || "",
    createdAt: new Date(),
  };

  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await ensureTableAndSeed(prisma);
      const created = await prisma.backlog.create({
        data: {
          id: entry.id,
          timestamp: entry.timestamp,
          userName: entry.userName,
          userRole: entry.userRole,
          action: entry.action,
          actionLabel: entry.actionLabel,
          module: entry.module,
          targetName: entry.targetName,
          description: entry.description,
        },
      });
      entry.id = created.id;
      return entry;
    } catch (err) {
      // Ghi thất bại mà vẫn unshift memory thì controller trả 201 cho một bản
      // ghi không tồn tại ở đâu cả; lỗi phải tới tay người gọi.
      console.error("[BacklogService] insert error:", err.message);
      throw serverError("Không ghi được nhật ký thao tác");
    }
  }

  memoryBacklogs.unshift(entry);
  return entry;
}

async function clear() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.backlog.deleteMany({});
    } catch (err) {
      // Xoá không xong mà vẫn trả ok thì admin tưởng nhật ký đã sạch.
      console.error("[BacklogService] clear error:", err.message);
      throw serverError("Không xóa được nhật ký thao tác");
    }
    return { ok: true };
  }
  memoryBacklogs = [];
  return { ok: true };
}

module.exports = {
  list,
  create,
  clear,
};

