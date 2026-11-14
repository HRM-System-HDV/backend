"use strict";
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const database = require("../config/database");
const { UnauthorizedError, ValidationError, ForbiddenError, NotFoundError } = require("../utils/errors");
const { signAccessToken, signRefreshToken, verifyToken } = require("../utils/jwt");
const ALLOWED_ROLES = ["admin", "manager", "staff"];
const users = new Map();
const devices = new Map();
const tokens = new Map();
const normalizeEmail = value => String(value || "").trim().toLowerCase();
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
function toSafeUser(row) {
  if (!row || !normalizeEmail(row.email).includes("@") || !ALLOWED_ROLES.includes(row.systemRole)) throw new ValidationError("Thông tin tài khoản không hợp lệ");
  return { id: row.id, employeeId: row.employeeId || null, email: row.email, name: row.name, systemRole: row.systemRole, role: row.systemRole, branchId: row.branchId || null };
}
async function findUser(where) {
  const prisma = database.getPrisma();
  return prisma ? prisma.user.findUnique({ where }) : [...users.values()].find(row => Object.entries(where).every(([key, value]) => row[key] === value)) || null;
}
async function saveUser(id, data) {
  const prisma = database.getPrisma();
  if (prisma) return prisma.user.update({ where: { id }, data });
  const row = users.get(id);
  if (!row) throw new NotFoundError("Không tìm thấy tài khoản");
  Object.assign(row, data);
  return row;
}
// Nền tảng client (web/mobile) do API Gateway quyết định và truyền xuống qua
// header `x-client-platform` (Gateway đã xóa header giả mạo của client trước khi
// forward). Vì vậy:
//   - Ưu tiên header `x-client-platform` làm giá trị chuẩn.
//   - `body.clientPlatform` là dữ liệu KHÔNG TIN CẬY khi request đi qua Gateway
//     (client tự khai nền tảng được) -> chỉ dùng làm fallback cho lệnh gọi nội
//     bộ gọi thẳng identity-service mà không qua Gateway.
function clientPlatform(body = {}, req) {
  const fromHeader = String((req?.headers || {})["x-client-platform"] || "").trim().toLowerCase();
  const fromBody = String(body.clientPlatform || "").trim().toLowerCase();
  const value = fromHeader || fromBody || "web";
  if (!["web", "mobile"].includes(value)) throw new ValidationError("clientPlatform chỉ nhận web hoặc mobile");
  return value;
}
// Nhân viên (staff) chỉ được đăng nhập trên Mobile (RULES.md §7); admin và
// manager dùng được cả hai nền tảng nên không bị chặn. Ngoài ra phiên staff
// không được dùng cookie phiên web (hrm-session / hrm-refresh).
function requirePlatform(user, platform, req) {
  if (user.systemRole !== "staff") return;
  if (platform !== "mobile") throw new ForbiddenError("Nhân viên chỉ được đăng nhập trên Mobile");
  if (req?.cookies?.["hrm-refresh"] || req?.cookies?.["hrm-session"]) {
    throw new ForbiddenError("Nhân viên chỉ được đăng nhập trên Mobile");
  }
}
function clientInfo(req = {}) {
  const headers = req.headers || {};
  const read = name => { try { return headers[name] ? decodeURIComponent(String(headers[name])) : null; } catch { return String(headers[name]); } };
  // IP lấy từ header `x-client-ip` do Gateway chuẩn hóa từ socket. Tuyệt đối
  // không tin `x-forwarded-for` do client gửi vì client tự giả mạo được.
  const rawIp = String(headers["x-client-ip"] || (req.socket && req.socket.remoteAddress) || "").trim();
  const ipAddress = rawIp ? (rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp) : null;
  // `location` chỉ là dữ liệu hiển thị cho người dùng (client tự khai), KHÔNG
  // dùng để quyết định bảo mật.
  return { deviceName: read("x-device-name") || "Thiết bị không xác định", deviceType: read("x-device-type"), osInfo: read("x-os-info"), location: read("x-location"), ipAddress };
}
async function registerDevice(userId, req) {
  const data = { userId, ...clientInfo(req), lastSeenAt: new Date() };
  const prisma = database.getPrisma();
  if (prisma) return prisma.deviceSession.create({ data });
  const row = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
  devices.set(row.id, row);
  return row;
}
async function getDevice(id) {
  const prisma = database.getPrisma();
  return prisma ? prisma.deviceSession.findUnique({ where: { id } }) : devices.get(id);
}
async function storeToken(token, userId, deviceSessionId) {
  const payload = verifyToken(token);
  const data = { token, userId, deviceSessionId, expiresAt: new Date(payload.exp * 1000), revoked: false };
  const prisma = database.getPrisma();
  if (prisma) return prisma.refreshToken.create({ data });
  tokens.set(token, { id: crypto.randomUUID(), ...data, createdAt: new Date() });
}
async function revokeSessions(userId, deviceSessionId) {
  const prisma = database.getPrisma();
  const where = { userId, ...(deviceSessionId ? { deviceSessionId } : {}) };
  if (prisma) {
    await prisma.$transaction(async tx => {
      await tx.refreshToken.updateMany({ where, data: { revoked: true } });
      await tx.deviceSession.deleteMany({ where: { userId, ...(deviceSessionId ? { id: deviceSessionId } : {}) } });
    });
    return;
  }
  for (const record of tokens.values()) if (record.userId === userId && (!deviceSessionId || record.deviceSessionId === deviceSessionId)) record.revoked = true;
  for (const [id, row] of devices) if (row.userId === userId && (!deviceSessionId || id === deviceSessionId)) devices.delete(id);
}
async function issueTokens(row, platform, deviceSessionId) {
  const user = toSafeUser(row);
  const payload = { userId: user.id, employeeId: user.employeeId, email: user.email, name: user.name, role: user.systemRole, systemRole: user.systemRole, branchId: user.systemRole === "admin" ? null : user.branchId, clientPlatform: platform, deviceSessionId };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await storeToken(refreshToken, user.id, deviceSessionId);
  return { user, accessToken, refreshToken, deviceSessionId, clientPlatform: platform };
}
async function loginUseCase(body = {}, req) {
  const platform = clientPlatform(body, req);
  const row = await findUser({ email: normalizeEmail(body.email) });
  if (!row || !body.password || !(await bcrypt.compare(body.password, row.passwordHash))) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");
  requirePlatform(row, platform, req);
  const device = await registerDevice(row.id, req);
  return issueTokens(row, platform, device.id);
}
async function getMeUseCase(userId) {
  const row = await findUser({ id: userId });
  if (!row) throw new UnauthorizedError("Phiên đăng nhập hết hạn");
  return toSafeUser(row);
}
async function changePasswordUseCase({ userId, currentPassword, newPassword }) {
  if (typeof newPassword !== "string" || newPassword.length < 6 || !currentPassword) throw new ValidationError("Mật khẩu mới phải có tối thiểu 6 ký tự");
  const row = await findUser({ id: userId });
  if (!row || !(await bcrypt.compare(currentPassword, row.passwordHash))) throw new ValidationError("Mật khẩu hiện tại không chính xác");
  await saveUser(userId, { passwordHash: await bcrypt.hash(newPassword, 10) });
  await revokeSessions(userId);
  return { ok: true, allSessionsRevoked: true };
}
async function forgotPasswordUseCase({ email }) {
  if (!normalizeEmail(email).includes("@")) throw new ValidationError("Email không hợp lệ");
  return { ok: true, contactAdmin: true, message: "Vui lòng liên hệ quản trị viên để được cấp lại mật khẩu" };
}
function requireAdmin(actor) {
  if ((actor?.systemRole || actor?.role) !== "admin") throw new ForbiddenError("Chỉ quản trị viên được quản lý tài khoản");
}
async function resetPasswordByAdminUseCase({ email, actor }) {
  requireAdmin(actor);
  const row = await findUser({ email: normalizeEmail(email) });
  if (!row) throw new NotFoundError("Không tìm thấy tài khoản");
  if (row.id === actor.userId) throw new ValidationError("Hãy dùng chức năng đổi mật khẩu cho tài khoản của mình");
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  await saveUser(row.id, { passwordHash: await bcrypt.hash(tempPassword, 10) });
  await revokeSessions(row.id);
  return { ok: true, email: row.email, tempPassword };
}
async function refreshTokenUseCase(body = {}, req) {
  const { refreshToken } = body;
  let payload;
  try { payload = verifyToken(refreshToken); } catch { throw new UnauthorizedError("Refresh token không hợp lệ hoặc đã hết hạn"); }
  if (payload.type !== "refresh") throw new UnauthorizedError("Token không phải refresh token");
  const prisma = database.getPrisma();
  const record = prisma ? await prisma.refreshToken.findUnique({ where: { token: refreshToken } }) : tokens.get(refreshToken);
  if (!record || record.revoked || record.userId !== payload.userId || record.expiresAt <= new Date()) throw new UnauthorizedError("Refresh token không còn hiệu lực");
  const device = record.deviceSessionId ? await getDevice(record.deviceSessionId) : null;
  if (!device || device.userId !== payload.userId) throw new UnauthorizedError("Phiên thiết bị đã bị thu hồi");
  const row = await findUser({ id: payload.userId });
  if (!row) throw new UnauthorizedError("Tài khoản không còn tồn tại");
  // Nền tảng khi refresh: header do Gateway set là chuẩn; nếu gọi nội bộ không
  // qua Gateway thì lấy từ body, cuối cùng mới dùng nền tảng đã ký trong token.
  const platform = clientPlatform({ clientPlatform: body.clientPlatform || payload.clientPlatform }, req);
  if (platform !== payload.clientPlatform) throw new ForbiddenError("Không được chuyển nền tảng bằng refresh token");
  requirePlatform(row, platform, req);
  if (prisma) {
    const consumed = await prisma.refreshToken.updateMany({ where: { id: record.id, revoked: false }, data: { revoked: true } });
    if (consumed.count !== 1) throw new UnauthorizedError("Refresh token đã được sử dụng");
    await prisma.deviceSession.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  } else {
    if (record.revoked) throw new UnauthorizedError("Refresh token đã được sử dụng");
    record.revoked = true;
    device.lastSeenAt = new Date();
  }
  return issueTokens(row, platform, device.id);
}
async function getDevicesUseCase(userId, currentSessionId) {
  const prisma = database.getPrisma();
  const rows = prisma ? await prisma.deviceSession.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }) : [...devices.values()].filter(row => row.userId === userId);
  return rows.map(row => ({ ...row, isCurrent: row.id === currentSessionId }));
}
async function revokeDeviceUseCase(userId, deviceId) {
  const row = await getDevice(deviceId);
  if (!row || row.userId !== userId) throw new NotFoundError("Không tìm thấy thiết bị của bạn");
  await revokeSessions(userId, deviceId);
  return { removed: true };
}
async function logoutUseCase(userId, { refreshToken, deviceSessionId } = {}) {
  const prisma = database.getPrisma();
  if (refreshToken) {
    const record = prisma ? await prisma.refreshToken.findUnique({ where: { token: refreshToken } }) : tokens.get(refreshToken);
    if (record?.userId === userId) deviceSessionId = record.deviceSessionId;
  }
  if (deviceSessionId) await revokeSessions(userId, deviceSessionId);
  return { ok: true };
}
async function syncEmployeeUseCase({ employee, action = "upsert" }) {
  if (!employee || !isUuid(employee.id)) throw new ValidationError("employee.id phải là UUID");
  if (!["upsert", "resign", "delete"].includes(action)) throw new ValidationError("Thao tác đồng bộ không hợp lệ");
  if (employee.branchId != null && !isUuid(employee.branchId)) throw new ValidationError("branchId phải là UUID");
  const linked = await findUser({ employeeId: employee.id });
  if (["delete", "resign"].includes(action) || employee.status === "nghỉ việc") {
    if (linked) {
      await revokeSessions(linked.id);
      // Vô hiệu hóa mật khẩu nhưng giữ tài khoản và các ID lịch sử.
      await saveUser(linked.id, { passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10) });
    }
    return { ok: true, action: "disabled" };
  }
  const email = normalizeEmail(employee.email);
  if (!email.includes("@") || !employee.name?.trim()) throw new ValidationError("Thiếu email hoặc tên nhân viên hợp lệ");
  const byEmail = await findUser({ email });
  if ((linked && byEmail && linked.id !== byEmail.id) || (byEmail?.employeeId && byEmail.employeeId !== employee.id)) throw new ValidationError("Email đã gắn với hồ sơ nhân viên khác");
  const existing = linked || byEmail;
  const data = { employeeId: employee.id, email, name: employee.name.trim(), branchId: employee.branchId || null };
  let row;
  if (existing) {
    if (existing.branchId !== data.branchId) await revokeSessions(existing.id);
    row = await saveUser(existing.id, data);
  } else {
    const create = { ...data, systemRole: "staff", passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10) };
    const prisma = database.getPrisma();
    row = prisma ? await prisma.user.create({ data: create }) : { id: crypto.randomUUID(), ...create, createdAt: new Date() };
    if (!prisma) users.set(row.id, row);
  }
  return { ok: true, action: existing ? "updated" : "created", user: toSafeUser(row) };
}
async function listUsersUseCase(actor) {
  requireAdmin(actor);
  const prisma = database.getPrisma();
  const rows = prisma ? await prisma.user.findMany({ orderBy: { createdAt: "desc" } }) : [...users.values()];
  return rows.map(toSafeUser);
}
async function getEmployeeRolesUseCase(employeeIds) {
  if (!Array.isArray(employeeIds) || employeeIds.length > 500 || employeeIds.some(id => !isUuid(id))) throw new ValidationError("employeeIds phải là danh sách tối đa 500 UUID");
  if (!employeeIds.length) return [];
  const ids = [...new Set(employeeIds)];
  const prisma = database.getPrisma();
  return prisma ? prisma.user.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, systemRole: true } })
    : [...users.values()].filter(row => ids.includes(row.employeeId)).map(row => ({ employeeId: row.employeeId, systemRole: row.systemRole }));
}
async function updateUserUseCase(id, body, actor) {
  requireAdmin(actor);
  if (!isUuid(id) || !ALLOWED_ROLES.includes(body.systemRole)) throw new ValidationError("ID hoặc vai trò không hợp lệ");
  if (!(await findUser({ id }))) throw new NotFoundError("Không tìm thấy tài khoản");
  const row = await saveUser(id, { systemRole: body.systemRole });
  await revokeSessions(id);
  return toSafeUser(row);
}
module.exports = { getEmployeeRolesUseCase, ALLOWED_ROLES, toSafeUser, clientPlatform, loginUseCase, getMeUseCase, changePasswordUseCase, forgotPasswordUseCase, resetPasswordByAdminUseCase, refreshTokenUseCase, getDevicesUseCase, revokeDeviceUseCase, logoutUseCase, syncEmployeeUseCase, listUsersUseCase, updateUserUseCase };
