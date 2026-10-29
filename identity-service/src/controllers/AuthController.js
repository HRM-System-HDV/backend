"use strict";

const {
  loginUseCase,
  getMeUseCase,
  changePasswordUseCase,
  forgotPasswordUseCase,
  refreshTokenUseCase,
  getDevicesUseCase,
  revokeDeviceUseCase,
  syncEmployeeUseCase,
} = require("../services/AuthService");
const {
  validateLogin,
  validateChangePassword,
  validateForgotPassword,
} = require("../validators/authValidator");
const { ValidationError } = require("../utils/errors");
const { COOKIE_NAME } = require("../middlewares/session");
const config = require("../config");

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: config.nodeEnv === "production",
  };
}

async function login(req, res, next) {
  try {
    const errors = validateLogin(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const result = await loginUseCase(req.body, req);
    res.cookie(COOKIE_NAME, result.accessToken, cookieOptions());
    return res.status(200).json({
      data: { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken },
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

async function logout(_req, res, next) {
  try {
    res.clearCookie(COOKIE_NAME, { path: "/" });
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
      message: "Mật khẩu đã được đặt lại về 123456",
    });
  } catch (e) {
    return next(e);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshToken = req.body?.refreshToken || req.headers["x-refresh-token"];
    const result = await refreshTokenUseCase({ refreshToken });
    res.cookie(COOKIE_NAME, result.accessToken, cookieOptions());
    return res.status(200).json({
      data: result,
      message: "Cấp lại token thành công",
    });
  } catch (e) {
    return next(e);
  }
}

async function getDevices(req, res, next) {
  try {
    const devices = await getDevicesUseCase(req.user.userId);
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
  login,
  me,
  logout,
  changePassword,
  forgotPassword,
  refresh,
  getDevices,
  revokeDevice,
  syncEmployee,
};
