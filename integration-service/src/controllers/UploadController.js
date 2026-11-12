"use strict";

const FileService = require("../services/FileService");

async function handleUpload(req, res, next) {
  try {
    const file = req.body?.file || req.body?.image || req.body?.dataUrl || req.body?.base64;
    const folder = req.body?.folder || "hrm";
    const uploadedBy = req.headers["x-user-id"] || null;
    const branchSlug = req.headers["x-branch-slug"] || null;

    const result = await FileService.upload(file, folder, uploadedBy, branchSlug);
    return res.status(200).json({
      data: result,
      message: "Tải ảnh lên thành công",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleUpload,
};