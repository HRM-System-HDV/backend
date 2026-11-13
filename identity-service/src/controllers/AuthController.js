"use strict";

const {
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
  listUsersUseCase,
  updateUserUseCase,
} = require("../services/AuthService");
const {
  validateLogin,
  validateChangePassword,
  validateForgotPassword,
} = require("../validators/authValidator");
const { ValidationError } = require("../utils/errors");
const { COOKIE_NAME } = require("../middlewares/session");
const config = require("../config");

// Cookie refresh đi kèm: web không cất token trong JS, nên hết access token phải
// đổi được token mới bằng cookie (httpOnly) thay vì bắt người dùng đăng nhập lại.
const REFRESH_COOKIE_NAME = "hrm-refresh";

// jsonwebtoken chấp nhận "15m", "7d", "3600"... -> số ms cho cookie maxAge.
function ttlToMs(value, fallbackMs) {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(String(value || "").trim());
  if (!match) return fallbackMs;
  const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[
    (match[2] || "s").toLowerCase()
  ];
  return Number(match[1]) * unitMs;
}

const ACCESS_COOKIE_MAX_AGE_MS = ttlToMs(config.jwtExpiresIn, 15 * 60 * 1000);
const REFRESH_COOKIE_MAX_AGE_MS = ttlToMs(config.jwtRefreshExpiresIn, 7 * 24 * 60 * 60 * 1000);

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: config.nodeEnv === "production",
  };
}

async function login(req, res, next) {
  try {
    const errors = validateLogin(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const result = await loginUseCase(req.body, req);
    const isWeb = result.clientPlatform === "web";
    if (isWeb) {
      res.cookie(COOKIE_NAME, result.accessToken, cookieOptions(ACCESS_COOKIE_MAX_AGE_MS));
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions(REFRESH_COOKIE_MAX_AGE_MS));
    }
    // Web: refresh token chỉ nằm trong cookie httpOnly, KHÔNG trả trong body
    // (body đọc được bằng JS nên dễ bị lộ qua XSS hoặc log của proxy).
    // Mobile: lưu trong Keychain/Keystore nên vẫn trả refresh token trong body.
    const data = {
      user: result.user,
      accessToken: result.accessToken,
      deviceSessionId: result.deviceSessionId,
    };
    if (!isWeb) data.refreshToken = result.refreshToken;
    return res.status(200).json({
      data,
      message: "Đăng nhập thành công",
    });
  } catch (e) {
    return next(e);
  }
}

async function me(req, res, next) {
  try {
    const user = await getMeUseCase(req.user.userId);
    return res.status(200).json({ data: user, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function logout(req, res, next) {
  try {
    await logoutUseCase(req.user.userId, {
      // Web không giữ refresh token trong JS nên phải lấy từ cookie, nếu không
      // đăng xuất chỉ xoá cookie mà refresh token 7 ngày vẫn còn hiệu lực.
      refreshToken: req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME],
      deviceSessionId: req.user.deviceSessionId,
    });
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
    return res.status(200).json({ data: { ok: true }, message: "Đăng xuất thành công" });
  } catch (e) {
    return next(e);
  }
}

async function changePassword(req, res, next) {
  try {
    const errors = validateChangePassword(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const result = await changePasswordUseCase({
      userId: req.user.userId,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    return res.status(200).json({ data: result, message: "Đổi mật khẩu thành công" });
  } catch (e) {
    return next(e);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const errors = validateForgotPassword(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const result = await forgotPasswordUseCase(req.body);
    return res.status(200).json({
      data: result,
      message: "Vui lòng liên hệ quản trị viên để được cấp lại mật khẩu",
    });
  } catch (e) {
    return next(e);
  }
}

async function resetPassword(req, res, next) {
  try {
    const errors = validateForgotPassword(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const result = await resetPasswordByAdminUseCase({
      email: req.body.email,
      actor: req.user,
    });
    return res.status(200).json({
      data: result,
      message: "Đã cấp mật khẩu tạm, hãy chuyển cho nhân viên và yêu cầu họ đổi lại",
    });
  } catch (e) {
    return next(e);
  }
}

async function refresh(req, res, next) {
  try {
    // Refresh token chỉ nhận từ body (mobile) hoặc cookie httpOnly (web).
    // KHÔNG nhận qua header `x-refresh-token`: header bị ghi vào log của proxy,
    // access log và gateway -> rò rỉ token ra ngoài.
    const refreshToken = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
    const result = await refreshTokenUseCase({ refreshToken, clientPlatform: req.body?.clientPlatform }, req);
    const isWeb = result.clientPlatform === "web";
    if (isWeb) res.cookie(COOKIE_NAME, result.accessToken, cookieOptions(ACCESS_COOKIE_MAX_AGE_MS));
    // refreshTokenUseCase xoay vòng token cũ -> phải ghi đè cookie, nếu không lần
    // sau client trình bày đúng token đã bị thu hồi và phiên chết hẳn.
    if (result.refreshToken && isWeb) {
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions(REFRESH_COOKIE_MAX_AGE_MS));
    }
    // Web không nhận refresh token trong body (chỉ cookie httpOnly); mobile thì có.
    const data = { ...result };
    if (isWeb) delete data.refreshToken;
    return res.status(200).json({
      data,
      message: "Cấp lại token thành công",
    });
  } catch (e) {
    return next(e);
  }
}

async function getDevices(req, res, next) {
  try {
    const devices = await getDevicesUseCase(req.user.userId, req.user.deviceSessionId);
    return res.status(200).json({ data: devices, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function revokeDevice(req, res, next) {
  try {
    const result = await revokeDeviceUseCase(req.user.userId, req.params.id);
    return res.status(200).json({ data: result, message: "Gỡ thiết bị thành công" });
  } catch (e) {
    return next(e);
  }
}

async function syncEmployee(req, res, next) {
  try {
    const { employee, action } = req.body || {};
    const result = await syncEmployeeUseCase({ employee, action });
    return res.status(200).json({ data: result, message: "Đồng bộ nhân sự thành công" });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  getUserName: async (req, res, next) => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw new ValidationError("ID phải là UUID");
      const user = await getMeUseCase(req.params.id);
      res.json({ data: { id: user.id, name: user.name } });
    } catch (error) { next(error); }
  },
  listUsers: async (req, res, next) => { try { res.json({ data: await listUsersUseCase(req.user) }); } catch (error) { next(error); } },
  updateUser: async (req, res, next) => { try { res.json({ data: await updateUserUseCase(req.params.id, req.body || {}, req.user) }); } catch (error) { next(error); } },
  login,
  me,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
  refresh,
  getDevices,
  revokeDevice,
  syncEmployee,
};
