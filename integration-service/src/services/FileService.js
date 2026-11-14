"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const config = require("../config");
const database = require("../config/database");
const storage = require("../utils/localStorage");
const { validateFolder, parseDataUrl } = require("../validators/fileValidator");

// Chế độ không DB: đăng ký file trong bộ nhớ để dev vẫn upload được.
const memoryAssets = new Map();

function notFoundError(message = "Không tìm thấy tệp") {
  const err = new Error(message);
  err.status = 404;
  err.code = "NOT_FOUND";
  return err;
}

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  return err;
}

function assertPublicId(publicId) {
  const segments = String(publicId).split("/");
  if (segments.length < 2 || segments.length > 3 || segments.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) {
    throw validationError("Định danh tệp không hợp lệ");
  }
  return segments.join("/");
}

async function findAsset(publicId) {
  const prisma = database.getPrisma();
  if (!prisma) return memoryAssets.get(publicId) || null;
  return prisma.fileAsset.findUnique({ where: { publicId } });
}

async function createAsset(row) {
  const prisma = database.getPrisma();
  if (!prisma) {
    memoryAssets.set(row.publicId, row);
    return row;
  }
  return prisma.fileAsset.create({ data: row });
}

async function markDeleted(publicId) {
  const prisma = database.getPrisma();
  const deletedAt = new Date();
  if (!prisma) {
    const row = memoryAssets.get(publicId);
    if (row) row.deletedAt = deletedAt;
    return;
  }
  await prisma.fileAsset.updateMany({ where: { publicId }, data: { deletedAt } });
}

async function upload(dataUrl, folder, uploadedBy = null, branchId = null, regulationId = null) {
  const safeFolder = validateFolder(folder);
  const { mime, buffer, ext, format } = parseDataUrl(dataUrl);
  const publicId = `${safeFolder}/${crypto.randomUUID()}`;
  const storagePath = `${publicId}.${ext}`;
  await storage.saveBuffer(storagePath, buffer);
  try { await createAsset({
    id: crypto.randomUUID(),
    publicId,
    folder: safeFolder,
    storagePath,
    mime,
    bytes: buffer.length,
    uploadedBy: uploadedBy || null,
    branchId: branchId || null,
    regulationId: regulationId || null,
    createdAt: new Date(),
    deletedAt: null,
  }); } catch(error) { await storage.unlink(storagePath); throw error; }
  const url = `${config.publicBaseUrl}/api/files/${publicId}`;
  return {
    url,
    secure_url: url,
    publicId,
    public_id: publicId,
    format,
    bytes: buffer.length,
  };
}

async function getByPublicId(publicId) {
  const id = assertPublicId(publicId);
  const asset = await findAsset(id);
  if (!asset || asset.deletedAt) throw notFoundError();
  const st = await storage.stat(asset.storagePath);
  if (!st) throw notFoundError();
  return { asset, bytes: st.size };
}

async function deleteByPublicId(publicId) {
  const id = assertPublicId(publicId);
  const asset = await findAsset(id);
  if (!asset || asset.deletedAt) return { deleted: false };
  await storage.unlink(asset.storagePath);
  await markDeleted(id);
  return { deleted: true };
}

// URL cũ (CDN bên ngoài, data URL) không thuộc lưu trữ nội bộ → bỏ qua.
function publicIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = "/api/files/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length).split(/[?#]/)[0];
  try {
    return assertPublicId(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

async function deleteByUrl(url) {
  const publicId = publicIdFromUrl(url);
  if (!publicId) return { deleted: false };
  return deleteByPublicId(publicId);
}

async function findForRegulation(regulationId) {
  const prisma=database.getPrisma();
  return prisma ? prisma.fileAsset.findMany({where:{regulationId,deletedAt:null}}) : [...memoryAssets.values()].filter(row=>row.regulationId===regulationId && !row.deletedAt);
}

module.exports = {
  findForRegulation,
  upload,
  getByPublicId,
  deleteByPublicId,
  deleteByUrl,
  publicIdFromUrl,
};
