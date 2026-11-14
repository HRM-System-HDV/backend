"use strict";

const express = require("express");
const ctrl = require("../controllers/ArchiveController");

const router = express.Router();

router.post("/preview", ctrl.preview);
router.post("/run", ctrl.run);
router.get("/tasks", ctrl.list);
router.get("/tasks/:id", ctrl.detail);
router.post("/tasks/:id/restore", ctrl.restore);

module.exports = router;