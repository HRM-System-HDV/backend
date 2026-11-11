"use strict";

const express = require("express");
const ctrl = require("../controllers/ArchiveController");

const router = express.Router();

router.post("/run", ctrl.run);

router.get("/requests", ctrl.listHandler("request"));
router.get("/requests/:id", ctrl.detailHandler("request"));
router.post("/requests/:id/restore", ctrl.restoreHandler("request"));

router.get("/notifications", ctrl.listHandler("notification"));
router.get("/notifications/:id", ctrl.detailHandler("notification"));
router.post("/notifications/:id/restore", ctrl.restoreHandler("notification"));

module.exports = router;