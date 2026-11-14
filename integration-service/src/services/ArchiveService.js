"use strict";

const crypto = require("node:crypto");
const database = require("../config/database");
const { parseDate, toVnDate } = require("../utils/dateFormat");

// Điều kiện chuyển vào kho lưu trữ: đơn đã xử lý / thông báo đã đọc, quá hạn cutoff.
const TYPES = {
  request: {
    model: "request",
    archiveModel: "archivedRequest",
    where: (cutoff) => ({ status: { in: ["approved", "rejected"] }, createdAt: { lt: cutoff } }),
  },
  notification: {
    model: "notification",
    archiveModel: "archivedNotification",
    where: (cutoff) => ({ isRead: true, createdAt: { lt: cutoff } }),
  },
};

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function requirePrisma() {
  const prisma = database.getPrisma();
  if (!prisma) {
    throw httpError(500, "INTERNAL_SERVER_ERROR", "Chức năng lưu trữ yêu cầu kết nối cơ sở dữ liệu");
  }
  return prisma;
}

function parseCutoff(body = {}) {
  const { months, cutoffDate } = body;
  const hasMonths = months !== undefined && months !== null && months !== "";
  const hasDate = cutoffDate !== undefined && cutoffDate !== null && cutoffDate !== "";
  if (hasMonths === hasDate) {
    throw httpError(400, "VALIDATION_ERROR", "Cần truyền đúng một trong hai: months hoặc cutoffDate");
  }
  if (hasMonths) {
    const value = Number(months);
    if (!Number.isInteger(value) || value < 1 || value > 120) {
      throw httpError(400, "VALIDATION_ERROR", "months phải là số nguyên từ 1 đến 120");
    }
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - value);
    return cutoff;
  }
  const cutoff = parseDate(cutoffDate);
  if (!cutoff) {
    throw httpError(400, "VALIDATION_ERROR", "cutoffDate không hợp lệ (định dạng DD/MM/YYYY, vd 31/01/2025)");
  }
  return cutoff;
}

function parseTypes(types) {
  const allowed = Object.keys(TYPES);
  if (types === undefined || types === null) return allowed;
  if (!Array.isArray(types) || types.length === 0 || types.some((t) => !allowed.includes(t))) {
    throw httpError(400, "VALIDATION_ERROR", `types phải gồm các giá trị: ${allowed.join(", ")}`);
  }
  return [...new Set(types)];
}

function parseLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return 500;
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1 || value > 2000) {
    throw httpError(400, "VALIDATION_ERROR", "limit phải là số nguyên từ 1 đến 2000");
  }
  return value;
}

function typeSpec(type) {
  const spec = TYPES[type];
  if (!spec) throw httpError(404, "NOT_FOUND", "Không tìm thấy loại dữ liệu lưu trữ");
  return spec;
}

async function preview(body = {}) {
  const prisma = requirePrisma();
  const cutoff = parseCutoff(body);
  const types = parseTypes(body.types);
  const counts = {};
  for (const type of types) {
    const spec = TYPES[type];
    counts[type] = await prisma[spec.model].count({ where: spec.where(cutoff) });
  }
  return { cutoffDate: toVnDate(cutoff), counts };
}

// Chuyển từng batch trong một transaction; client lặp tới khi remaining = 0
// để mỗi lời gọi nằm trong timeout 5000ms của gateway.
async function run(body = {}) {
  const prisma = requirePrisma();
  const cutoff = parseCutoff(body);
  const types = parseTypes(body.types);
  const limit = parseLimit(body.limit);
  const batchId = crypto.randomUUID();
  const archivedAt = new Date();
  const moved = {};
  const remaining = {};
  for (const type of types) {
    const spec = TYPES[type];
    const where = spec.where(cutoff);
    const rows = await prisma[spec.model].findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    if (rows.length > 0) {
      const data = rows.map((row) => ({ ...row, archivedAt, archiveBatchId: batchId }));
      await prisma.$transaction([
        prisma[spec.archiveModel].createMany({ data }),
        prisma[spec.model].deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
      ]);
    }
    moved[type] = rows.length;
    remaining[type] = await prisma[spec.model].count({ where });
  }
  return { batchId, cutoffDate: toVnDate(cutoff), moved, remaining };
}

function parseDateFilter(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const date = parseDate(value) || new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, "VALIDATION_ERROR", `${label} không hợp lệ`);
  }
  return date;
}

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { page, pageSize };
}

async function list(type, query = {}) {
  const prisma = requirePrisma();
  const spec = typeSpec(type);
  const fetchAll = query.all === "true" || query.all === true || query.all === "1";
  const { page, pageSize } = parsePagination(query);
  const where = {};
  if (query.q) where.title = { contains: String(query.q), mode: "insensitive" };
  if (query.branchSlug) where.branchSlug = query.branchSlug;
  if (type === "request") {
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
  }
  if (type === "notification" && query.targetEmployeeId) {
    where.targetEmployeeId = query.targetEmployeeId;
  }
  const from = parseDateFilter(query.from, "from");
  const to = parseDateFilter(query.to, "to");
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  const [items, total] = await Promise.all([
    prisma[spec.archiveModel].findMany({
      where,
      orderBy: { archivedAt: "desc" },
      ...(fetchAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    }),
    prisma[spec.archiveModel].count({ where }),
  ]);
  return { items, total, page: fetchAll ? 1 : page, pageSize: fetchAll ? total : pageSize };
}

async function detail(type, id) {
  const prisma = requirePrisma();
  const spec = typeSpec(type);
  const row = await prisma[spec.archiveModel].findUnique({ where: { id } });
  if (!row) throw httpError(404, "NOT_FOUND", "Không tìm thấy bản ghi lưu trữ");
  return row;
}

async function restore(type, id) {
  const prisma = requirePrisma();
  const spec = typeSpec(type);
  const archived = await prisma[spec.archiveModel].findUnique({ where: { id } });
  if (!archived) throw httpError(404, "NOT_FOUND", "Không tìm thấy bản ghi lưu trữ");
  const live = await prisma[spec.model].findUnique({ where: { id } });
  if (live) {
    throw httpError(409, "DUPLICATE_RESOURCE", "Bản ghi đã tồn tại trong danh sách hoạt động");
  }
  const { archivedAt, archiveBatchId, ...data } = archived;
  await prisma.$transaction([
    prisma[spec.model].create({ data }),
    prisma[spec.archiveModel].delete({ where: { id } }),
  ]);
  return { restored: true, id };
}

module.exports = { preview, run, list, detail, restore };