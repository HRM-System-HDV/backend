"use strict";

const express = require("express");
const RequestController = require("../controllers/RequestController");

const router = express.Router();

router.get("/", RequestController.listRequests);
router.get("/:id", RequestController.getRequestById);
router.post("/", RequestController.createRequest);
router.put("/:id/approve", RequestController.approveRequest);
router.put("/:id/reject", RequestController.rejectRequest);
router.delete("/:id", RequestController.deleteRequest);

module.exports = router;
