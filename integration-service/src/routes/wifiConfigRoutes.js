"use strict";

const express = require("express");
const WifiConfigController = require("../controllers/WifiConfigController");

const router = express.Router();

router.get("/", WifiConfigController.getAllWifiConfigs);
router.get("/:id", WifiConfigController.getWifiConfigById);
router.post("/", WifiConfigController.createWifiConfig);
router.put("/:id", WifiConfigController.updateWifiConfig);
router.delete("/:id", WifiConfigController.deleteWifiConfig);

module.exports = router;
