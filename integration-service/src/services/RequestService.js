"use strict";

const database = require("../config/database");
const { SEED_REQUESTS } = require("../../prisma/seed");
const NotificationService = require("./NotificationService");
const WorkClient = require("../clients/WorkClient");

let memoryRequests = JSON.parse(JSON.stringify(SEED_REQUESTS)).map((r) => ({
  ...r,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function findMany({ employeeId, branchSlug, status, type } = {}) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryRequests.filter((r) => {
      if (employeeId && r.employeeId !== employeeId) return false;
      if (branchSlug && r.branchSlug !== branchSlug) return false;
      if (status && r.status !== status) return false;
      if (type && r.type !== type) return false;
      return true;
    });
  }
  const where = {};
  if (employeeId) where.employeeId = employeeId;
  if (branchSlug) where.branchSlug = branchSlug;
  if (status) where.status = status;
  if (type) where.type = type;
  return prisma.request.findMany({ where, orderBy: { createdAt: "desc" } });
}

async function findById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryRequests.find((r) => r.id === id) || null;
  }
  return prisma.request.findUnique({ where: { id } });
}

async function create(data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const newReq = {
      id: data.id || `req-${Date.now()}`,
      status: "pending",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryRequests.unshift(newReq);
    return newReq;
  }
  return prisma.request.create({ data });
}

async function update(id, data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryRequests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    memoryRequests[idx] = { ...memoryRequests[idx], ...data, updatedAt: new Date() };
    return memoryRequests[idx];
  }
  return prisma.request.update({ where: { id }, data });
}

async function deleteById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryRequests.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    memoryRequests.splice(idx, 1);
    return true;
  }
  await prisma.request.delete({ where: { id } });
  return true;
}

async function reviewRequest(id, approved, { reviewedBy, reviewNote } = {}) {
  const row = await findById(id);
  if (!row) {
    const err = new Error("Không tìm thấy yêu cầu");
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (row.status !== "pending") {
    const err = new Error("Chỉ duyệt hoặc từ chối yêu cầu đang chờ xử lý");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const updated = await update(id, {
    status: approved ? "approved" : "rejected",
    reviewedBy: reviewedBy || "admin",
    reviewNote: reviewNote || "",
  });

  // Duyệt/từ chối tự sinh thông báo cho nhân viên.
  await NotificationService.create({
    targetEmployeeId: row.employeeId,
    branchSlug: row.branchSlug,
    title: approved ? "Yêu cầu của bạn đã được duyệt" : "Yêu cầu của bạn đã bị từ chối",
    body: `${approved ? "Đã duyệt" : "Đã từ chối"}: ${row.title}${reviewNote ? ` — ${reviewNote}` : ""}`,
  });

  // Duyệt đổi ca: đẩy cập nhật sang work-service (best-effort, không chặn luồng duyệt).
  if (approved && row.type === "shift_swap" && row.sourceShiftId) {
    try {
      await WorkClient.updateShift(row.sourceShiftId, {
        employeeId: row.employeeId,
      });
    } catch (e) {
      console.warn("[integration-service] Đồng bộ đổi ca sang work-service thất bại:", e.message);
    }
  }
  return updated;
}

async function approveRequest(id, review = {}) {
  return reviewRequest(id, true, review);
}

async function rejectRequest(id, review = {}) {
  return reviewRequest(id, false, review);
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  deleteById,
  approveRequest,
  rejectRequest,
};
