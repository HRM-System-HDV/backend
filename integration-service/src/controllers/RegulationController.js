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


const RegulationService = require("../services/RegulationService");
const { validateCreateRegulation } = require("../validators/regulationValidator");
const errorCodes = require("../utils/errors");

async function getAllRegulations(_req, res, next) {
  try {
    const list = await RegulationService.findMany();
    return res.status(200).json({ data: list });
  } catch (error) {
    next(error);
  }
}

async function getRegulationById(req, res, next) {
  try {
    const { id } = req.params;
    const item = await RegulationService.findById(id);
    if (!item) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy nội quy" },
      });
    }
    return res.status(200).json({ data: item });
  } catch (error) {
    next(error);
  }
}

async function createRegulation(req, res, next) {
  try {
    const errors = validateCreateRegulation(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: { code: errorCodes.VALIDATION_ERROR, message: errors.join(", ") },
      });
    }

    const code = req.body.code && typeof req.body.code === "string" && req.body.code.trim()
      ? req.body.code.trim()
      : await RegulationService.nextRegulationCode();

    const created = await RegulationService.create({
      code,
      title: req.body.title.trim(),
      category: req.body.category.trim(),
      summary: req.body.summary ? req.body.summary.trim() : "",
      content: req.body.content.trim(),
      status: req.body.status || "hiệu lực",
      scope: req.body.scope || "Toàn công ty",
      effectiveDate: formatDateVN(req.body.effectiveDate),
      expiryDate: req.body.expiryDate || null,
      version: req.body.version || "1.0",
      pinned: Boolean(req.body.pinned),
      attachments: typeof req.body.attachments === "number" ? req.body.attachments : 0,
    });

    return res.status(201).json({
      data: created,
      message: "Tạo nội quy thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function updateRegulation(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await RegulationService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy nội quy để cập nhật" },
      });
    }

    const payload = { ...req.body };
    delete payload.author;
    const updated = await RegulationService.update(id, payload);
    return res.status(200).json({
      data: updated,
      message: "Cập nhật nội quy thành công",
    });
  } catch (error) {
    next(error);
  }
}

async function deleteRegulation(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await RegulationService.findById(id);
    if (!existing) {
      return res.status(404).json({
        error: { code: errorCodes.NOT_FOUND, message: "Không tìm thấy nội quy để xóa" },
      });
    }

    await RegulationService.deleteById(id);
    return res.status(200).json({
      data: { id, deleted: true },
      message: "Xóa nội quy thành công",
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllRegulations,
  getRegulationById,
  createRegulation,
  updateRegulation,
  deleteRegulation,
};
