"use strict";

// AuthService (Flat 3-Tier Mẫu A): gộp UserRepository + DeviceRepository + User entity cũ,
// gọi trực tiếp Prisma + fallback in-memory. Luồng Route -> Controller -> Service -> Prisma.
const bcrypt = require("bcryptjs");
const database = require("../config/database");
const { UnauthorizedError, ValidationError, NotFoundError } = require("../utils/errors");
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

// --- Quản lý phiên thiết bị (gộp từ DeviceRepository cũ, lưu in-memory) ---
const userDevices = new Map();

function parseClientInfo(req) {
  const ua = req.headers["user-agent"] || "";
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";

  let deviceName = req.headers["x-device-name"];
  let deviceType = req.headers["x-device-type"];
  let osInfo = req.headers["x-os-info"];

  if (!deviceName) {
    if (ua.includes("iPhone")) {
      deviceName = "iPhone 15 Pro Max";
      deviceType = "phone";
      osInfo = "iOS 18.0 • HRM Mobile";
    } else if (ua.includes("iPad")) {
      deviceName = "iPad Pro 11\"";
      deviceType = "tablet";
      osInfo = "iPadOS 17.5 • HRM Mobile";
    } else if (ua.includes("Android")) {
      deviceName = "Samsung Galaxy S24";
      deviceType = "phone";
      osInfo = "Android 14 • HRM Mobile";
    } else if (ua.includes("Macintosh")) {
      deviceName = "MacBook Pro 14\"";
      deviceType = "desktop";
      osInfo = "macOS Sonoma • Chrome 127";
    } else if (ua.includes("Windows")) {
      deviceName = "Windows PC";
      deviceType = "desktop";
      osInfo = "Windows 11 • Edge 127";
    } else {
      deviceName = "Trình duyệt Web";
      deviceType = "desktop";
      osInfo = "Web Portal";
    }
  }

  return {
    deviceName,
    deviceType: deviceType || "desktop",
    osInfo: osInfo || "HRM System",
    location: "Hà Nội, Việt Nam",
    ipAddress: typeof ip === "string" ? ip.split(",")[0].trim() : "127.0.0.1",
  };
}

function initDefaultDevices() {
  return [
    {
      id: "dev-01",
      deviceName: "iPhone 15 Pro Max",
      deviceType: "phone",
      osInfo: "iOS 18.0 • Ứng dụng HRM Mobile",
      location: "Hà Nội, Việt Nam",
      ipAddress: "113.161.45.120",
      lastActive: "Đang hoạt động",
      isCurrent: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "dev-02",
      deviceName: "iPad Pro 11\"",
      deviceType: "tablet",
      osInfo: "iPadOS 17.5 • Ứng dụng HRM Mobile",
      location: "Hà Nội, Việt Nam",
      ipAddress: "113.161.45.120",
      lastActive: "2 giờ trước",
      isCurrent: false,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: "dev-03",
      deviceName: "MacBook Pro 14\"",
      deviceType: "desktop",
      osInfo: "macOS Sonoma • Chrome 127",
      location: "Hà Nội, Việt Nam",
      ipAddress: "14.241.224.89",
      lastActive: "Hôm qua lúc 18:30",
      isCurrent: false,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ];
}

async function getDevicesByUserId(userId) {
  if (!userDevices.has(userId)) {
    userDevices.set(userId, initDefaultDevices());
  }
  return userDevices.get(userId);
}

async function registerDevice(userId, req) {
  const client = parseClientInfo(req);
  const devices = await getDevicesByUserId(userId);

  devices.forEach((d) => (d.isCurrent = false));

  const existingIndex = devices.findIndex(
    (d) => d.deviceName === client.deviceName && d.ipAddress === client.ipAddress
  );

  const newDevice = {
    id: existingIndex >= 0 ? devices[existingIndex].id : `dev-${Date.now().toString().slice(-4)}`,
    deviceName: client.deviceName,
    deviceType: client.deviceType,
    osInfo: client.osInfo,
    location: client.location,
    ipAddress: client.ipAddress,
    lastActive: "Đang hoạt động",
    isCurrent: true,
    createdAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    devices[existingIndex] = newDevice;
  } else {
    devices.unshift(newDevice);
  }

  userDevices.set(userId, devices);
  return newDevice;
}

async function removeDevice(userId, deviceId) {
  const devices = await getDevicesByUserId(userId);
  const filtered = devices.filter((d) => d.id !== deviceId);
  userDevices.set(userId, filtered);
  return { removed: true, remainingCount: filtered.length };
}

// --- Use cases ---
async function loginUseCase({ email, password }, req) {
  if (!email || !password) throw new ValidationError("Thiếu email hoặc mật khẩu");
  const row = await findUserByEmail(email.toLowerCase().trim());
  if (!row) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) throw new UnauthorizedError("Email hoặc mật khẩu không đúng");
  const user = toSafeUser(row);
  const payload = { userId: user.id, email: user.email, role: user.role, branchSlug: user.branchSlug };

  if (req) {
    try {
      await registerDevice(user.id, req);
    } catch (_) {
      // Bỏ qua lỗi ghi nhận thiết bị
    }
  }

  return {
    user,
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
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
  return { ok: true };
}

async function forgotPasswordUseCase({ email }) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new ValidationError("Email không hợp lệ");
  }
  const row = await findUserByEmail(email.toLowerCase().trim());
  if (!row) {
    throw new NotFoundError("Không tìm thấy tài khoản với email này trên hệ thống");
  }
  // Đặt lại mật khẩu về mặc định 123456
  const defaultHash = await bcrypt.hash("123456", 10);
  await updateUserPassword(row.id, defaultHash);
  return { ok: true, reset: true, defaultPassword: "123456" };
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
  const row = await findUserById(payload.userId);
  if (!row) {
    throw new UnauthorizedError("Người dùng không còn tồn tại");
  }
  const user = toSafeUser(row);
  const tokenPayload = { userId: user.id, email: user.email, role: user.role, branchSlug: user.branchSlug };
  return {
    user,
    accessToken: signAccessToken(tokenPayload),
    refreshToken: signRefreshToken(tokenPayload),
  };
}

async function getDevicesUseCase(userId) {
  return await getDevicesByUserId(userId);
}

async function revokeDeviceUseCase(userId, deviceId) {
  if (!deviceId) throw new ValidationError("Thiếu deviceId");
  return await removeDevice(userId, deviceId);
}

async function syncEmployeeUseCase({ employee, action = "upsert" }) {
  if (!employee) return { ok: false };
  const prisma = database.getPrisma();

  if (action === "delete") {
    if (prisma) {
      await prisma.user
        .deleteMany({
          where: {
            OR: [
              employee.id ? { id: employee.id } : undefined,
              employee.email ? { email: employee.email } : undefined,
            ].filter(Boolean),
          },
        })
        .catch(() => {});
    }
    const idx = memoryUsers.findIndex(
      (u) => (employee.id && u.id === employee.id) || (employee.email && u.email === employee.email)
    );
    if (idx >= 0) memoryUsers.splice(idx, 1);
    return { ok: true, action: "delete" };
  }

  // action === "upsert"
  const rawRole = (employee.systemRole || employee.role || "staff").toString().toLowerCase();
  let role = "staff";
  if (rawRole.includes("admin") || rawRole === "admin") role = "admin";
  else if (rawRole.includes("quản lý") || rawRole.includes("manager") || rawRole === "manager") role = "manager";

  let roleTitle = employee.role || "Nhân viên";
  if (role === "admin") roleTitle = "Quản trị viên";
  else if (role === "manager") roleTitle = "Quản lý Chi nhánh";

  const email = (employee.email || "").trim().toLowerCase();
  if (!email) return { ok: false, error: "Thiếu email" };

  const name = (employee.name || "").trim() || "Nhân viên";
  const branchSlug = employee.branchSlug ? employee.branchSlug.toUpperCase() : null;

  if (prisma) {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          employee.id ? { id: employee.id } : undefined,
          { email },
        ].filter(Boolean),
      },
    });

    if (existing) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          email,
          name,
          role,
          roleTitle,
          branchSlug,
        },
      });
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
          passwordHash: bcrypt.hashSync("123456", 10),
        },
      });
      return { ok: true, action: "created", user: toSafeUser(created) };
    }
  } else {
    const idx = memoryUsers.findIndex(
      (u) => (employee.id && u.id === employee.id) || u.email === email
    );
    if (idx >= 0) {
      memoryUsers[idx] = {
        ...memoryUsers[idx],
        email,
        name,
        role,
        roleTitle,
        branchSlug,
      };
      return { ok: true, action: "updated", user: toSafeUser(memoryUsers[idx]) };
    } else {
      const newUser = {
        id: employee.id || `u-${Date.now()}`,
        email,
        name,
        role,
        roleTitle,
        branchSlug,
        passwordHash: bcrypt.hashSync("123456", 10),
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
  refreshTokenUseCase,
  getDevicesUseCase,
  revokeDeviceUseCase,
  syncEmployeeUseCase,
};
