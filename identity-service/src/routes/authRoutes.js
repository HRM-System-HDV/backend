"use strict";

const express = require("express");
const AuthController = require("../controllers/AuthController");
const { sessionMiddleware } = require("../middlewares/session");
const { internalOnly } = require("../middlewares/internalOnly");

const router = express.Router();

// Public routes
router.post("/login", AuthController.login);
router.post("/refresh", AuthController.refresh);
router.post("/forgot-password", AuthController.forgotPassword);

// Chỉ service nội bộ gọi thẳng, không qua gateway.
router.post("/sync-employee", internalOnly, AuthController.syncEmployee);
router.get("/internal/users/:id/name", internalOnly, AuthController.getUserName);
router.post("/internal/employee-roles", internalOnly, async (req, res, next) => {
  try { res.json({ data: await require("../services/AuthService").getEmployeeRolesUseCase(req.body?.employeeIds) }); }
  catch (error) { next(error); }
});

// Protected routes (cần phiên đăng nhập)
router.get("/me", sessionMiddleware, AuthController.me);
router.get("/users", sessionMiddleware, AuthController.listUsers);
router.put("/users/:id", sessionMiddleware, AuthController.updateUser);
router.post("/logout", sessionMiddleware, AuthController.logout);
router.post("/change-password", sessionMiddleware, AuthController.changePassword);
router.post("/reset-password", sessionMiddleware, AuthController.resetPassword);
router.get("/devices", sessionMiddleware, AuthController.getDevices);
router.delete("/devices/:id", sessionMiddleware, AuthController.revokeDevice);

module.exports = router;
