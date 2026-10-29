"use strict";

const { uploadImage } = require("../config/cloudinary");

async function handleUpload(req, res, next) {
  try {
    const file = req.body?.file || req.body?.image || req.body?.dataUrl || req.body?.base64;
    const folder = req.body?.folder || "hrm";

    if (!file) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Thiếu dữ liệu file ảnh (cần base64 Data URL)",
        },
      });
    }

    const result = await uploadImage(file, folder);
    return res.status(200).json({
      data: result,
      message: "Tải ảnh lên Cloudinary thành công",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleUpload,
};
