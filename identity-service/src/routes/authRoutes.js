"use strict";

const express = require("express");
const AuthController = require("../controllers/AuthController");
const { sessionMiddleware } = require("../middlewares/session");

const router = express.Router();

// Public routes
router.post("/login", AuthController.login);
router.post("/logout", AuthController.logout);
router.post("/refresh", AuthController.refresh);
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/sync-employee", AuthController.syncEmployee);

// Protected routes (cần phiên đăng nhập)
router.get("/me", sessionMiddleware, AuthController.me);
router.post("/change-password", sessionMiddleware, AuthController.changePassword);
router.get("/devices", sessionMiddleware, AuthController.getDevices);
router.delete("/devices/:id", sessionMiddleware, AuthController.revokeDevice);

module.exports = router;
