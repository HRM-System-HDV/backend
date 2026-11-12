"use strict";

const database = require("../config/database");
const { SEED_REQUESTS } = require("../../prisma/seed");
const NotificationService = require("./NotificationService");
const FileService = require("./FileService");
const WorkClient = require("../clients/WorkClient");
const { toVnDate } = require("../utils/dateFormat");

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

// Loại đơn cần đồng nghiệp (người được nhờ) phản hồi trước khi quản lý duyệt.
const RESPONDABLE_TYPES = new Set(["shift_swap"]);

const NOTIFICATION_TEXT_FIELDS = [
  "shiftName", "shiftDate", "shiftTime", "shiftHours",
  "senderName", "senderRole", "senderPhone",
];
const NOTIFICATION_META_FIELDS = [
  "branch", "shiftRole", "reason", "swapShiftName", "swapShiftTime",
  "swapShiftHours", "swapShiftDate", "swapShiftBranch", "swapShiftRole",
];
const MAX_TEXT = 300;
const MAX_REASON = 1000;

function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Chỉ nhận đúng các khóa hiển thị đã biết, tránh client nhét field lạ vào thông báo.
// Các khóa ngày ca luôn được chuẩn hóa DD/MM/YYYY trước khi lưu.
const VN_DATE_FIELDS = new Set(["shiftDate", "swapShiftDate"]);

function sanitizeNotificationFields(payload = {}) {
  const columns = {};
  for (const key of NOTIFICATION_TEXT_FIELDS) {
    let value = cleanText(payload[key], key === "senderPhone" ? 40 : MAX_TEXT);
    if (value && VN_DATE_FIELDS.has(key)) value = toVnDate(value) || value;
    if (value) columns[key] = value;
  }
  const metadata = {};
  for (const key of NOTIFICATION_META_FIELDS) {
    let value = cleanText(payload[key], key === "reason" ? MAX_REASON : MAX_TEXT);
    if (value && VN_DATE_FIELDS.has(key)) value = toVnDate(value) || value;
    if (value) metadata[key] = value;
  }
  return { columns, metadata };
}

function requestTypeOf(type) {
  if (type === "shift_swap") return "swap";
  return null;
}

function notFoundError(message = "Không tìm thấy yêu cầu") {
  const err = new Error(message);
  err.status = 404;
  err.code = "NOT_FOUND";
  return err;
}

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  return err;
}

function forbiddenError(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = "FORBIDDEN";
  return err;
}

async function nextRequestId() {
  const prisma = database.getPrisma();
  let max = 0;
  const prefix = "YC-";
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  if (prisma) {
    const rows = await prisma.request
      .findMany({ where: { id: { startsWith: prefix } }, select: { id: true } })
      .catch(() => []);
    rows.forEach((r) => scan(r.id));
  } else {
    memoryRequests.forEach((r) => scan(r.id));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function create(data, notification = null) {
  const prisma = database.getPrisma();
  let created;
  if (!data.id) {
    data.id = await nextRequestId();
  }
  if (!prisma) {
    created = {
      id: data.id,
      status: "pending",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryRequests.unshift(created);
  } else {
    created = await prisma.request.create({ data });
  }

  // Nhờ làm thay / đổi ca: báo cho đồng nghiệp được nhờ, kèm requestId để
  // mobile mở đúng đơn khi bấm vào thông báo (thay vì dùng id thông báo).
  if (data.targetEmployeeId && RESPONDABLE_TYPES.has(data.type)) {
    try {
      const { columns, metadata } = sanitizeNotificationFields(notification || {});
      await NotificationService.create({
        targetEmployeeId: data.targetEmployeeId,
        branchSlug: data.branchSlug || null,
        title: created.title,
        body: created.content,
        requestType: requestTypeOf(data.type),
        ...columns,
        metadata: {
          ...metadata,
          requestId: created.id,
          requestStatus: "pending",
        },
      });
    } catch (e) {
      // Không chặn việc tạo đơn nếu gửi thông báo lỗi.
      console.warn("[integration-service] Gửi thông báo yêu cầu ca thất bại:", e.message);
    }
  }

  return created;
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
  const row = await findById(id);
  if (!row) return false;
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryRequests.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    memoryRequests.splice(idx, 1);
  } else {
    await prisma.request.delete({ where: { id } });
  }
  // Xóa ảnh đính kèm best-effort; ảnh mồ côi còn lại đã có scan-orphans đối soát.
  if (row.attachmentUrl) {
    FileService.deleteByUrl(row.attachmentUrl).catch((e) => {
      console.warn("[integration-service] Xóa ảnh đính kèm thất bại:", e.message);
    });
  }
  return true;
}

async function reviewRequest(id, approved, { reviewedBy, reviewNote } = {}) {
  const row = await findById(id);
  if (!row) throw notFoundError();
  if (row.status !== "pending") {
    throw validationError("Chỉ duyệt hoặc từ chối yêu cầu đang chờ xử lý");
  }
  // Duyệt đổi ca: hoán đổi THỰC SỰ hai ca sang work-service.
  // Ca nguồn (của người gửi) sang người được nhờ, ca đích sang người gửi.
  // Phải đồng bộ TRƯỚC khi ghi status: nếu work-service lỗi mà đơn đã approved
  // thì manager nhận 500 nhưng đơn không còn pending để duyệt lại, ca vĩnh viễn
  // không đổi.
  if (approved && row.type === "shift_swap" && row.sourceShiftId && row.targetEmployeeId) {
    let sourceAssigned = false;
    try {
      await WorkClient.updateShift(row.sourceShiftId, { employeeId: row.targetEmployeeId });
      sourceAssigned = true;
      if (row.targetShiftId) {
        await WorkClient.updateShift(row.targetShiftId, { employeeId: row.employeeId });
      }
    } catch (e) {
      console.error("[integration-service] Đồng bộ đổi ca sang work-service thất bại:", e.message);
      // Nửa hoán đổi còn tệ hơn không hoán đổi: người được nhờ đang mang cả ca của
      // mình lẫn ca vừa gán. Trả ca nguồn về chủ cũ; nếu hoàn tác cũng hỏng thì
      // log đủ dữ liệu để sửa tay.
      if (sourceAssigned) {
        await WorkClient.updateShift(row.sourceShiftId, { employeeId: row.employeeId })
          .catch((rollbackError) => {
            console.error(
              `[integration-service] Cần hoàn tác thủ công ca ${row.sourceShiftId} về ${row.employeeId}:`,
              rollbackError.message
            );
          });
      }
      throw e;
    }
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
    metadata: {
      requestId: id,
      requestStatus: approved ? "approved" : "rejected",
    },
  });

  // Đơn nhờ làm thay / đổi ca: đồng nghiệp được nhờ cũng phải nhận kết quả cuối,
  // nếu không họ chỉ biết phản hồi của chính mình và không hay biết gì sau đó.
  if (row.targetEmployeeId && RESPONDABLE_TYPES.has(row.type)) {
    await NotificationService.create({
      targetEmployeeId: row.targetEmployeeId,
      branchSlug: row.branchSlug,
      title: approved ? "Yêu cầu được nhờ đã có kết quả" : "Yêu cầu được nhờ đã bị từ chối",
      body: `${approved ? "Đã duyệt" : "Đã từ chối"}: ${row.title}${reviewNote ? ` — ${reviewNote}` : ""}`,
      requestType: requestTypeOf(row.type),
      metadata: {
        requestId: id,
        requestStatus: approved ? "approved" : "rejected",
      },
    });
  }

  return updated;
}

async function approveRequest(id, review = {}) {
  return reviewRequest(id, true, review);
}

async function rejectRequest(id, review = {}) {
  return reviewRequest(id, false, review);
}

// Đồng nghiệp được nhờ làm thay / đổi ca trả lời. Chỉ đúng người nhận đơn
// (targetEmployeeId) mới được phản hồi, và chỉ khi đơn còn chờ xử lý.
async function respondRequest(id, accepted, { responderId } = {}) {
  const row = await findById(id);
  if (!row) throw notFoundError();
  if (!RESPONDABLE_TYPES.has(row.type)) {
    throw validationError("Đơn này không cần đồng nghiệp phản hồi");
  }
  if (!responderId || row.targetEmployeeId !== responderId) {
    throw forbiddenError("Bạn không phải người được nhờ trong yêu cầu này");
  }
  if (row.status !== "pending") {
    throw validationError("Yêu cầu này đã được xử lý");
  }
  return reviewRequest(id, Boolean(accepted), {
    reviewedBy: responderId,
    reviewNote: accepted ? "Đồng nghiệp đã chấp nhận" : "Đồng nghiệp đã từ chối",
  });
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  deleteById,
  approveRequest,
  rejectRequest,
  respondRequest,
};
