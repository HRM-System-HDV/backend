"use strict";

const express = require("express");
const SoapConfigController = require("../controllers/SoapConfigController");

const router = express.Router();

router.get("/", SoapConfigController.getSoapConfig);
router.put("/", SoapConfigController.updateSoapConfig);

module.exports = router;
