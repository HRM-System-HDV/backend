"use strict";

const express = require("express");
const BacklogController = require("../controllers/BacklogController");

const router = express.Router();

router.get("/", BacklogController.listBacklogs);
router.post("/", BacklogController.createBacklog);
router.delete("/", BacklogController.clearBacklogs);

module.exports = router;

