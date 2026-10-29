"use strict";

const crypto = require("crypto");
const https = require("https");
const config = require("./index");

/**
 * Upload an image (base64 data URI or remote URL) to Cloudinary.
 * @param {string} fileData - Base64 Data URI or image URL.
 * @param {string} [folder="hrm"] - Cloudinary target folder.
 * @returns {Promise<{ url: string, publicId: string, format: string, width: number, height: number }>}
 */
async function uploadImage(fileData, folder = "hrm") {
  if (!fileData || typeof fileData !== "string") {
    throw new Error("Dữ liệu ảnh không hợp lệ (cần base64 string hoặc URL)");
  }

  const cloudName = config.cloudinary.cloudName;
  const apiKey = config.cloudinary.apiKey;
  const secrets = [
    config.cloudinary.apiSecret,
    config.cloudinary.fallbackSecret,
  ].filter(Boolean);

  let lastError = null;

  for (const secret of secrets) {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = folder ? `folder=${folder}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
      const signature = crypto.createHash("sha1").update(paramsToSign + secret).digest("hex");

      const body = JSON.stringify({
        file: fileData,
        timestamp,
        api_key: apiKey,
        signature,
        ...(folder ? { folder } : {})
      });

      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: "api.cloudinary.com",
          path: `/v1_1/${cloudName}/image/upload`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });

      let parsed = {};
      try {
        parsed = JSON.parse(res.body);
      } catch (_) {
        parsed = { error: { message: res.body } };
      }

      if (res.status === 200 && (parsed.secure_url || parsed.url)) {
        const url = parsed.secure_url || parsed.url;
        const publicId = parsed.public_id || "";
        // Trả cả hai kiểu tên trường: `url`/`publicId` cho web-mobile hiện có và
        // `secure_url`/`public_id` theo hợp đồng BUSINESS.md §7.5.
        return {
          url,
          secure_url: url,
          publicId,
          public_id: publicId,
          format: parsed.format || "png",
          width: parsed.width || 0,
          height: parsed.height || 0,
          bytes: parsed.bytes || 0,
        };
      } else {
        lastError = new Error(parsed?.error?.message || `Lỗi Cloudinary HTTP ${res.status}`);
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Không thể tải ảnh lên Cloudinary");
}

module.exports = {
  uploadImage,
};
