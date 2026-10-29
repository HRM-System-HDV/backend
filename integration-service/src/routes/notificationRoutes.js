"use strict";

const express = require("express");
const NotificationController = require("../controllers/NotificationController");

const router = express.Router();

router.get("/settings", NotificationController.getSettings);
router.put("/settings", NotificationController.updateSettings);
router.get("/", NotificationController.listNotifications);
router.post("/", NotificationController.createNotification);
router.put("/read-all", NotificationController.markAllAsRead);
router.put("/:id/read", NotificationController.markAsRead);
router.delete("/:id", NotificationController.deleteNotification);

module.exports = router;
