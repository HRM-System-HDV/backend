"use strict";

const express = require("express");
const ctrl = require("../controllers/FileController");

const router = express.Router();

// Tuyến tĩnh phải đặt trước wildcard.
router.post("/scan-orphans", ctrl.scanOrphans);
router.post("/purge-orphans", ctrl.purgeOrphans);
router.get("/*", ctrl.getFile);
router.delete("/*", ctrl.deleteFile);

module.exports = router;