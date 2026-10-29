"use strict";

const express = require("express");
const NewsController = require("../controllers/NewsController");

const router = express.Router();

router.get("/", NewsController.getAllNews);
router.get("/:id", NewsController.getNewsById);
router.post("/", NewsController.createNews);
router.put("/:id", NewsController.updateNews);
router.delete("/:id", NewsController.deleteNews);

module.exports = router;
