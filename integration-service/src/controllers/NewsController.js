"use strict";

function formatDateVN(dateInput) {
  if (!dateInput) {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, "0");
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const y = now.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const str = String(dateInput).trim();
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[1].padStart(2, "0")}/${slashMatch[2].padStart(2, "0")}/${slashMatch[3]}`;
  }
  const hyphenMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (hyphenMatch) {
    return `${hyphenMatch[1].padStart(2, "0")}/${hyphenMatch[2].padStart(2, "0")}/${hyphenMatch[3]}`;
  }
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, "0")}/${isoMatch[2].padStart(2, "0")}/${isoMatch[1]}`;
  }
  return str;
}


const NewsService = require("../services/NewsService");
const { validateCreateNews } = require("../validators/newsValidator");
const errorCodes = require("../utils/errors");

async function getAllNews(_req, res, next) {
  try {
    const list = await NewsService.findMany();
    return res.status(200).json({ data: list });
  } catch (error) {
    next(error);
  }
}

async function getNewsById(req, res, next) {
  try {
    const { id } = req.params;
    const item = await NewsService.findById(id);
    if (!item) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy tin tức" },
      });
    }
    return res.status(200).json({ data: item });
  } catch (error) {
    next(error);
  }
}

async function createNews(req, res, next) {
  try {
    const errors = validateCreateNews(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: errors.join(", ") },
      });
    }

    const created = await NewsService.create({
      title: req.body.title.trim(),
      summary: req.body.summary.trim(),
      content: req.body.content.trim(),
      date: formatDateVN(req.body.date),
      tag: req.body.tag ? req.body.tag.trim() : "Thông báo chung",
      tagTone: req.body.tagTone || "primary",
      pinned: Boolean(req.body.pinned),
      branch: req.body.branch ? req.body.branch.trim() : "Toàn công ty",
    });

    return res.status(201).json({
      data: created,
      message: "Tạo tin tức thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function updateNews(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await NewsService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy tin tức để cập nhật" },
      });
    }

    const payload = { ...req.body };
    delete payload.author;
    const updated = await NewsService.update(id, payload);
    return res.status(200).json({
      data: updated,
      message: "Cập nhật tin tức thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function deleteNews(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await NewsService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy tin tức để xóa" },
      });
    }

    await NewsService.deleteById(id);
    return res.status(200).json({
      data: { id, deleted: true },
      message: "Xóa tin tức thành công",
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllNews,
  getNewsById,
  createNews,
  updateNews,
  deleteNews,
};
