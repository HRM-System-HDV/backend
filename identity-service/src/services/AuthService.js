"use strict";

// AuthService (Flat 3-Tier Mẫu A): gộp UserRepository + DeviceRepository + User entity cũ,
// gọi trực tiếp Prisma + fallback in-memory. Luồng Route -> Controller -> Service -> Prisma.
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const database = require("../config/database");
const { UnauthorizedError, ValidationError, ForbiddenError, NotFoundError } = require("../utils/errors");
const { signAccessToken, signRefreshToken, verifyToken } = require("../utils/jwt");

const ALLOWED_ROLES = ["admin", "manager", "staff"];

// Helper thay User entity cũ: validate + ẩn passwordHash khỏi response.
function toSafeUser(row) {
  if (!row || !row.email || !row.email.includes("@")) {
    const e = new Error("Email không hợp lệ");
    e.code = "VALIDATION_ERROR";
    e.status = 400;
    throw e;
  }
  if (!ALLOWED_ROLES.includes(row.role)) {
    const e = new Error("Vai trò không hợp lệ");
    e.code = "VALIDATION_ERROR";
    e.status = 400;
    throw e;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    roleTitle: row.roleTitle,
    branchSlug: row.branchSlug || null,
  };
}

// --- Truy xuất User (gộp từ UserRepository cũ) ---
const SEED_DEFS = [
  { id: "NV-0001", email: "admin@company.com", name: "Trần Minh Tuấn", role: "admin", roleTitle: "Quản trị viên", branchSlug: null },
];

const memoryUsers = SEED_DEFS.map((u) => ({
  ...u,
  passwordHash: bcrypt.hashSync("123456", 10),
}));

async function findUserByEmail(email) {
  const prisma = database.getPrisma();
  if (!prisma) return memoryUsers.find((u) => u.email === email) || null;
  const row = await prisma.user.findUnique({ where: { email } });
  return row || null;
}

async function findUserById(id) {
  const prisma = database.getPrisma();
  if (!prisma) return memoryUsers.find((u) => u.id === id) || null;
  const row = await prisma.user.findUnique({ where: { id } });
  return row || null;
}

async function updateUserPassword(id, passwordHash) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const u = memoryUsers.find((u) => u.id === id);
    if (u) u.passwordHash = passwordHash;
    return;
  }
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (!prisma) return { mode: "memory", count: memoryUsers.length };
  // Chỉ tạo tài khoản admin mặc định nếu DB chưa có.
  // KHÔNG xoá các tài khoản khác: dữ liệu tài khoản thật phải được giữ nguyên.
  for (const def of SEED_DEFS) {
    const existed = await prisma.user.findUnique({ where: { email: def.email } });
    if (!existed) {
      await prisma.user.create({
        data: { ...def, passwordHash: bcrypt.hashSync("123456", 10) },
      });
    }
  }
  const count = await prisma.user.count();
  return { mode: "postgres", count };
}

// --- Quản lý phiên thiết bị: mỗi phiên gắn với refresh token để thu hồi thật ---
const userDevices = new Map(); // userId -> [device] (fallback in-memory)
const memoryTokens = new Map(); // token -> { userId, deviceSessionId, revoked }

function parseClientInfo(req) {
  const ua = req.headers["user-agent"] || "";
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";

  // Header chỉ chứa ASCII nên client encode URI; giải mã để lấy tên thật.
  const readHeader = (name) => {
    const raw = req.headers[name];
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch (_) {
      return raw;
    }
  };

  // Thông tin thật do client gửi; thiếu thì ghi chung chung, không đoán model cụ thể.
  const deviceName = readHeader("x-device-name") || "Thiết bị không xác định";
  let deviceType = readHeader("x-device-type");
  if (!deviceType) {
    if (/iPhone|Android.*Mobile|Windows Phone/i.test(ua)) deviceType = "phone";
    else if (/iPad|Tablet/i.test(ua)) deviceType = "tablet";
    else deviceType = "desktop";
  }
  const osInfo = readHeader("x-os-info") || "HRM System";

  return {
    deviceName,
    deviceType,
    osInfo,
    location: "Không xác định",
    ipAddress: typeof ip === "string" ? ip.split(",")[0].trim() : "127.0.0.1",
  };
}

function lastActiveLabel(updatedAt, isCurrent) {
  if (isCurrent) return "Đang hoạt động";
  const t = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return "Không rõ";
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Hôm qua";
  if (days < 7) return `${days} ngày trước`;
  return `${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear()}`;
}

function serializeDevice(d, currentSessionId) {
  const isCurrent = d.id === currentSessionId;
  return {
    id: d.id,
    deviceName: d.deviceName,
    deviceType: d.deviceType,
    osInfo: d.osInfo,
    location: d.location,
    ipAddress: d.ipAddress,
    lastActive: lastActiveLabel(d.updatedAt || d.createdAt, isCurrent),
    isCurrent,
    createdAt: d.createdAt && d.createdAt.toISOString ? d.createdAt.toISOString() : String(d.createdAt),
  };
}

async function getDevicesByUserId(userId, currentSessionId) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const devices = await prisma.deviceSession.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      return devices.map((d) => serializeDevice(d, currentSessionId));
    } catch (err) {
      console.error("[identity-service] Lỗi getDevicesByUserId prisma:", err);
    }
  }
  return (userDevices.get(userId) || []).map((d) => serializeDevice(d, currentSessionId));
}

async function registerDevice(userId, req) {
  const client = parseClientInfo(req);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const existing = await prisma.deviceSession.findFirst({
        where: { userId, deviceName: client.deviceName, ipAddress: client.ipAddress },
      });
      if (existing) {
        // Đăng nhập lại trên cùng thiết bị: token cũ của phiên đó hết hiệu lực.
        await prisma.refreshToken.updateMany({
          where: { deviceSessionId: existing.id },
          data: { revoked: true },
        });
        return await prisma.deviceSession.update({
          where: { id: existing.id },
          data: {
            deviceType: client.deviceType,
            osInfo: client.osInfo,
            location: client.location,
            lastActive: "Đang hoạt động",
          },
        });
      }
      return await prisma.deviceSession.create({
        data: {
          userId,
          deviceName: client.deviceName,
          deviceType: client.deviceType,
          osInfo: client.osInfo,
          location: client.location,
          ipAddress: client.ipAddress,
          lastActive: "Đang hoạt động",
          isCurrent: false,
        },
      });
    } catch (err) {
      console.error("[identity-service] Lỗi registerDevice prisma:", err);
    }
  }

  const devices = userDevices.get(userId) || [];
  const existing = devices.find(
    (d) => d.deviceName === client.deviceName && d.ipAddress === client.ipAddress
  );
  if (existing) {
    for (const rec of memoryTokens.values()) {
      if (rec.userId === userId && rec.deviceSessionId === existing.id) rec.revoked = true;
    }
    Object.assign(existing, client, { lastActive: "Đang hoạt động", updatedAt: new Date().toISOString() });
    return existing;
  }
  const device = {
    id: `dev-${crypto.randomUUID()}`,
    userId,
    ...client,
    lastActive: "Đang hoạt động",
    isCurrent: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  devices.unshift(device);
  userDevices.set(userId, devices);
  return device;
}

async function storeRefreshToken(token, userId, deviceSessionId) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.refreshToken.upsert({
        where: { token },
        update: { revoked: false, deviceSessionId },
        create: { token, userId, deviceSessionId },
      });
      return;
    } catch (err) {
      console.error("[identity-service] Lỗi lưu refreshToken prisma:", err);
    }
  }
  memoryTokens.set(token, { userId, deviceSessionId, revoked: false });
}

async function removeDevice(userId, deviceId) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const sessions = await prisma.deviceSession.findMany({
        where: {
          userId,
          OR: [{ id: deviceId }, { id: { endsWith: `_${deviceId}` } }],
        },
        select: { id: true },
      });
      const ids = sessions.map((s) => s.id);
      if (ids.length) {
        await prisma.refreshToken.updateMany({
          where: { deviceSessionId: { in: ids } },
          data: { revoked: true },
        });
        await prisma.deviceSession.deleteMany({ where: { id: { in: ids } } });
      }
      const remainingCount = await prisma.deviceSession.count({ where: { userId } });
      return { removed: ids.length > 0, remainingCount };
    } catch (err) {
      console.error("[identity-service] Lỗi removeDevice prisma:", err);
    }
  }

  const devices = userDevices.get(userId) || [];
  const removedIds = devices
    .filter((d) => d.id === deviceId || d.id.endsWith(`_${deviceId}`))
    .map((d) => d.id);
  for (const rec of memoryTokens.values()) {
    if (rec.userId === userId && removedIds.includes(rec.deviceSessionId)) rec.revoked = true;
  }
  const filtered = devices.filter((d) => !removedIds.includes(d.id));
  userDevices.set(userId, filtered);
  return { removed: removedIds.length > 0, remainingCount: filtered.length };
}

// Đổi mật khẩu / đăng xuất toàn bộ: mọi refresh token và phiên thiết bị chết ngay.
async function revokeAllSessions(userId) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
      await prisma.deviceSession.deleteMany({ where: { userId } });
      return;
    } catch (err) {
      console.error("[identity-service] Lỗi revokeAllSessions prisma:", err);
    }
  }
  for (const rec of memoryTokens.values()) {
    if (rec.userId === userId) rec.revoked = true;
  }
  userDevices.delete(userId);
}

// --- Use cases ---
async function loginUseCase({ email, password }, req) {
  if (!email || !password) throw new ValidationError("Thiếu email hoặc mật khẩu");
  const row = await findUserByEmail(email.toLowerCase().trim());
  if (!row) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");
  const user = toSafeUser(row);
  // Admin không có chi nhánh trong mô hình 3 vai trò. Ký null dù DB còn sót giá trị
  // cũ để gateway (app.js:54) không gắn x-branch-slug, nếu không admin bị giam số liệu.
  const payload = {
    userId: user.id,
    email: user.email,
    // Tên hiển thị đi kèm token: service phía sau dùng làm "người gửi"
    // (thông báo, tin tức) mà không tin body của client.
    name: user.name || null,
    role: user.role,
    branchSlug: user.role === "admin" ? null : user.branchSlug,
  };

  let deviceSessionId = null;
  if (req) {
    try {
      const device = await registerDevice(user.id, req);
      deviceSessionId = device ? device.id : null;
    } catch (_) {
      // Bỏ qua lỗi ghi nhận thiết bị
    }
  }

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await storeRefreshToken(refreshToken, user.id, deviceSessionId);

  return {
    user,
    accessToken,
    refreshToken,
    deviceSessionId,
  };
}

async function getMeUseCase(userId) {
  const row = await findUserById(userId);
  if (!row) {
    throw new UnauthorizedError("Phiên đăng nhập hết hạn");
  }
  return toSafeUser(row);
}

async function changePasswordUseCase({ userId, currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) {
    throw new ValidationError("Thiếu mật khẩu hiện tại hoặc mật khẩu mới");
  }
  if (newPassword.length < 6) {
    throw new ValidationError("Mật khẩu mới phải có tối thiểu 6 ký tự");
  }
  const row = await findUserById(userId);
  if (!row) {
    throw new NotFoundError("Không tìm thấy thông tin tài khoản");
  }
  const ok = await bcrypt.compare(currentPassword, row.passwordHash);
  if (!ok) {
    throw new ValidationError("Mật khẩu hiện tại không chính xác");
  }
  const newHash = await bcrypt.hash(newPassword, 10);
  await updateUserPassword(userId, newHash);
  // Đổi mật khẩu là đăng xuất mọi thiết bị: token cũ không được sống tiếp.
  await revokeAllSessions(userId);
  return { ok: true, allSessionsRevoked: true };
}

// Hệ thống chưa có kênh gửi email/SMS nên không thể tự đặt lại mật khẩu an toàn.
// Trả lời giống nhau cho mọi email để không lộ tài khoản nào tồn tại.
async function forgotPasswordUseCase({ email }) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new ValidationError("Email không hợp lệ");
  }
  return {
    ok: true,
    contactAdmin: true,
    message: "Vì lý do bảo mật, vui lòng liên hệ quản trị viên hoặc quản lý để được cấp lại mật khẩu.",
  };
}

// Chỉ admin/manager được đặt lại mật khẩu người khác. Mật khẩu tạm sinh ngẫu nhiên,
// chỉ trả về một lần cho người thao tác để họ chuyển cho nhân viên.
async function resetPasswordByAdminUseCase({ email, actor }) {
  if (!actor || !["admin", "manager"].includes(actor.role)) {
    throw new ForbiddenError("Chỉ quản trị viên hoặc quản lý được đặt lại mật khẩu");
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new ValidationError("Email không hợp lệ");
  }
  const row = await findUserByEmail(email.toLowerCase().trim());
  if (!row) {
    throw new NotFoundError("Không tìm thấy tài khoản với email này trên hệ thống");
  }
  // Quản lý không được chiếm tài khoản quản trị viên.
  if (actor.role === "manager" && row.role === "admin") {
    throw new ForbiddenError("Quản lý không được đặt lại mật khẩu quản trị viên");
  }
  if (actor.userId && row.id === actor.userId) {
    throw new ValidationError("Hãy dùng đổi mật khẩu để thay đổi mật khẩu của chính mình");
  }
  const tempPassword = crypto.randomBytes(9).toString("base64url");
  await updateUserPassword(row.id, await bcrypt.hash(tempPassword, 10));
  await revokeAllSessions(row.id);
  return { ok: true, email: row.email, tempPassword };
}

async function refreshTokenUseCase({ refreshToken }) {
  if (!refreshToken) {
    throw new ValidationError("Thiếu refresh token");
  }
  let payload;
  try {
    payload = verifyToken(refreshToken);
  } catch (err) {
    throw new UnauthorizedError("Refresh token không hợp lệ hoặc đã hết hạn");
  }
  if (payload.type !== "refresh") {
    throw new UnauthorizedError("Token cung cấp không phải là refresh token");
  }

  const prisma = database.getPrisma();
  let tokenRecord = null;
  if (prisma) {
    try {
      tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });
    } catch (err) {
      console.error("[identity-service] Lỗi kiểm tra refreshToken:", err);
    }
  } else {
    tokenRecord = memoryTokens.get(refreshToken) || null;
  }
  if (tokenRecord && tokenRecord.revoked) {
    throw new UnauthorizedError("Refresh token đã bị thu hồi");
  }
  if (tokenRecord && tokenRecord.deviceSessionId) {
    // Phiên thiết bị đã bị gỡ từ xa thì token chết ngay, không cấp lại được.
    let sessionAlive = true;
    if (prisma) {
      try {
        sessionAlive = !!(await prisma.deviceSession.findUnique({
          where: { id: tokenRecord.deviceSessionId },
        }));
      } catch (_) {}
    } else {
      sessionAlive = (userDevices.get(payload.userId) || []).some(
        (d) => d.id === tokenRecord.deviceSessionId
      );
    }
    if (!sessionAlive) {
      throw new UnauthorizedError("Phiên đăng nhập đã bị đăng xuất khỏi thiết bị");
    }
  }

  const row = await findUserById(payload.userId);
  if (!row) {
    throw new UnauthorizedError("Người dùng không còn tồn tại");
  }
  const user = toSafeUser(row);
  const tokenPayload = {
    userId: user.id,
    email: user.email,
    name: user.name || null,
    role: user.role,
    branchSlug: user.role === "admin" ? null : user.branchSlug,
  };
  const newAccessToken = signAccessToken(tokenPayload);
  const newRefreshToken = signRefreshToken(tokenPayload);

  const deviceSessionId = tokenRecord ? tokenRecord.deviceSessionId : null;
  if (prisma) {
    try {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken },
        data: { revoked: true },
      });
      if (deviceSessionId) {
        await prisma.deviceSession.update({
          where: { id: deviceSessionId },
          data: { lastActive: "Đang hoạt động" },
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[identity-service] Lỗi cập nhật refreshToken:", err);
    }
  } else if (tokenRecord) {
    tokenRecord.revoked = true;
  }
  await storeRefreshToken(newRefreshToken, user.id, deviceSessionId);

  return {
    user,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

async function getDevicesUseCase(userId, currentSessionId) {
  return await getDevicesByUserId(userId, currentSessionId);
}

async function revokeDeviceUseCase(userId, deviceId) {
  if (!deviceId) throw new ValidationError("Thiếu deviceId");
  return await removeDevice(userId, deviceId);
}

// Đăng xuất chủ động: thu hồi token + xóa phiên của chính thiết bị đang gọi.
async function logoutUseCase(userId, { refreshToken, deviceSessionId } = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      if (refreshToken) {
        await prisma.refreshToken.updateMany({
          where: { token: refreshToken, userId },
          data: { revoked: true },
        });
      }
      if (deviceSessionId) {
        await prisma.refreshToken.updateMany({
          where: { userId, deviceSessionId },
          data: { revoked: true },
        });
        await prisma.deviceSession.deleteMany({ where: { userId, id: deviceSessionId } });
      }
      return { ok: true };
    } catch (err) {
      console.error("[identity-service] Lỗi logoutUseCase prisma:", err);
    }
  }
  if (refreshToken) {
    const rec = memoryTokens.get(refreshToken);
    if (rec && rec.userId === userId) rec.revoked = true;
  }
  if (deviceSessionId) {
    for (const rec of memoryTokens.values()) {
      if (rec.userId === userId && rec.deviceSessionId === deviceSessionId) rec.revoked = true;
    }
    userDevices.set(
      userId,
      (userDevices.get(userId) || []).filter((d) => d.id !== deviceSessionId)
    );
  }
  return { ok: true };
}

async function syncEmployeeUseCase({ employee, action = "upsert" }) {
  if (!employee) return { ok: false };
  const prisma = database.getPrisma();

  if (action === "delete") {
    // Mã nhân sự ở organization và users.id là hai không gian sinh mã độc lập,
    // nên chỉ xóa khi khớp cả mã lẫn email (nếu có) để không xóa nhầm tài khoản
    // của người khác đang trùng mã.
    const email = (employee.email || "").trim().toLowerCase();
    const where = employee.id ? { id: employee.id, ...(email ? { email } : {}) } : null;
    let deleted = false;
    if (prisma && where) {
      const res = await prisma.user.deleteMany({ where }).catch(() => null);
      deleted = Boolean(res && res.count);
    }
    const idx = memoryUsers.findIndex((u) => {
      if (!employee.id || u.id !== employee.id) return false;
      return email ? String(u.email || "").toLowerCase() === email : true;
    });
    if (idx >= 0) {
      memoryUsers.splice(idx, 1);
      deleted = true;
    }
    // Chỉ revoke khi xoá được tài khoản. where không khớp nghĩa là lệnh xoá bị bỏ
    // qua cố ý, mà revoke thì vẫn đá người đang dùng khỏi hệ thống.
    if (deleted) await revokeAllSessions(employee.id);
    return { ok: true, action: "delete" };
  }

  // action === "upsert"
  // Vai trò hệ thống là enum (admin|manager|staff) nên được ưu tiên; chuỗi
  // "role" chỉ là chức danh tự do, so chuỗi nó sẽ biến "Nhân viên quản lý
  // chất lượng" thành quản lý.
  const SYSTEM_ROLES = new Set(["admin", "manager", "staff"]);
  const systemRole = (employee.systemRole || "").toString().trim().toLowerCase();
  const rawRole = (employee.role || "").toString().trim().toLowerCase();
  let role = "staff";
  if (SYSTEM_ROLES.has(systemRole)) {
    role = systemRole;
  } else if (rawRole === "admin") {
    role = "admin";
  } else if (rawRole === "manager") {
    role = "manager";
  } else if (rawRole.includes("quản trị") || rawRole.includes("admin")) {
    role = "admin";
  } else if (rawRole.includes("quản lý") || rawRole.includes("manager")) {
    role = "manager";
  }

  let roleTitle = employee.role || "Nhân viên";
  if (role === "admin") roleTitle = "Quản trị viên";
  else if (role === "manager") roleTitle = "Quản lý Chi nhánh";

  const email = (employee.email || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Thiếu email" };

  const name = (employee.name || "").trim() || "Nhân viên";
  const branchSlug = employee.branchSlug ? employee.branchSlug.toUpperCase() : null;

  if (prisma) {
    const byId = employee.id
      ? await prisma.user.findUnique({ where: { id: employee.id } })
      : null;
    const byEmail = await prisma.user.findUnique({ where: { email } });

    // Không được "cướp" tài khoản: mã đã thuộc người khác thì báo xung đột để
    // organization đổi mã nhân sự, thay vì đổi email/mật khẩu của tài khoản đó.
    if (byId && String(byId.email).toLowerCase() !== email) {
      return { ok: false, code: "ID_CONFLICT", identityId: byId.id, email: byId.email };
    }
    // Email đã có tài khoản với mã khác: organization nên dùng lại đúng mã đó.
    if (byEmail && (!byId || byEmail.id !== byId.id)) {
      return { ok: false, code: "EMAIL_EXISTS", identityId: byEmail.id, email: byEmail.email };
    }

    if (byId) {
      const updated = await prisma.user.update({
        where: { id: byId.id },
        data: {
          email,
          name,
          role,
          roleTitle,
          branchSlug,
        },
      });
      // Đổi vai trò hoặc chi nhánh thì thu hồi mọi phiên: access token cũ mang
      // theo role/branchSlug trong payload và gateway chỉ kiểm chữ ký, nên nếu
      // không revoke, manager bị giáng xuống staff vẫn giữ quyền cũ tới hết TTL.
      const privilegeChanged = byId.role !== role || byId.branchSlug !== branchSlug;
      if (privilegeChanged) await revokeAllSessions(byId.id);
      return { ok: true, action: "updated", user: toSafeUser(updated) };
    } else {
      const created = await prisma.user.create({
        data: {
          id: employee.id || undefined,
          email,
          name,
          role,
          roleTitle,
          branchSlug,
          // Không đặt mật khẩu mặc định: ai biết email cũng đăng nhập được.
          // Quản trị viên cấp mật khẩu tạm qua POST /api/auth/reset-password.
          passwordHash: bcrypt.hashSync(crypto.randomBytes(24).toString("base64url"), 10),
        },
      });
      return { ok: true, action: "created", user: toSafeUser(created) };
    }
  } else {
    const byId = employee.id ? memoryUsers.find((u) => u.id === employee.id) : null;
    const byEmail = memoryUsers.find((u) => u.email === email);
    if (byId && String(byId.email || "").toLowerCase() !== email) {
      return { ok: false, code: "ID_CONFLICT", identityId: byId.id, email: byId.email };
    }
    if (byEmail && (!byId || byEmail.id !== byId.id)) {
      return { ok: false, code: "EMAIL_EXISTS", identityId: byEmail.id, email: byEmail.email };
    }
    const existing = byId || byEmail;
    if (existing) {
      const idx = memoryUsers.indexOf(existing);
      const privilegeChanged = existing.role !== role || existing.branchSlug !== branchSlug;
      memoryUsers[idx] = {
        ...memoryUsers[idx],
        email,
        name,
        role,
        roleTitle,
        branchSlug,
      };
      // Như nhánh prisma: đổi vai trò/chi nhánh phải làm chết các phiên đang sống.
      if (privilegeChanged) await revokeAllSessions(existing.id);
      return { ok: true, action: "updated", user: toSafeUser(memoryUsers[idx]) };
    } else {
      const newUser = {
        id: employee.id || `u-${Date.now()}`,
        email,
        name,
        role,
        roleTitle,
        branchSlug,
        passwordHash: bcrypt.hashSync(crypto.randomBytes(24).toString("base64url"), 10),
      };
      memoryUsers.push(newUser);
      return { ok: true, action: "created", user: toSafeUser(newUser) };
    }
  }
}

module.exports = {
  ALLOWED_ROLES,
  toSafeUser,
  ensureSeeded,
  loginUseCase,
  getMeUseCase,
  changePasswordUseCase,
  forgotPasswordUseCase,
  resetPasswordByAdminUseCase,
  refreshTokenUseCase,
  getDevicesUseCase,
  revokeDeviceUseCase,
  logoutUseCase,
  syncEmployeeUseCase,
};
