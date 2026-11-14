"use strict";

const express = require("express");
const ctrl = require("../controllers/FileController");

const router = express.Router();

router.get("/*", ctrl.getFile);
router.delete("/*", ctrl.deleteFile);

module.exports = router;