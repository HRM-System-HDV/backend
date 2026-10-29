"use strict";

const express = require("express");
const RegulationController = require("../controllers/RegulationController");

const router = express.Router();

router.get("/", RegulationController.getAllRegulations);
router.get("/:id", RegulationController.getRegulationById);
router.post("/", RegulationController.createRegulation);
router.put("/:id", RegulationController.updateRegulation);
router.delete("/:id", RegulationController.deleteRegulation);

module.exports = router;
