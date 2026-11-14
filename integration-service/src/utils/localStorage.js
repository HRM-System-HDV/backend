"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const config = require("../config");

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = "VALIDATION_ERROR";
  return err;
}

// Mọi đường dẫn phải nằm trong STORAGE_DIR — chặn traversal (../, tuyệt đối).
function resolveSafe(relPath) {
  const root = path.resolve(config.storageDir);
  const abs = path.resolve(root, String(relPath));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw validationError("Đường dẫn tệp không hợp lệ");
  }
  return abs;
}

async function ensureRoot() {
  await fsp.mkdir(path.resolve(config.storageDir), { recursive: true });
}

async function saveBuffer(relPath, buffer) {
  const abs = resolveSafe(relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buffer);
}

function readStream(relPath) {
  return fs.createReadStream(resolveSafe(relPath));
}

async function stat(relPath) {
  try {
    return await fsp.stat(resolveSafe(relPath));
  } catch {
    return null;
  }
}

async function unlink(relPath) {
  try {
    await fsp.unlink(resolveSafe(relPath));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

// Liệt kê file đệ quy, trả đường dẫn tương đối dùng làm storagePath.
async function walk(relDir = "") {
  const rootAbs = resolveSafe(relDir);
  const results = [];
  async function scan(absDir, relPrefix) {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await scan(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        const st = await fsp.stat(path.join(absDir, entry.name)).catch(() => null);
        if (st) results.push({ relPath: rel, bytes: st.size, mtimeMs: st.mtimeMs });
      }
    }
  }
  await scan(rootAbs, relDir ? String(relDir).replace(/\\/g, "/") : "");
  return results;
}

module.exports = { resolveSafe, ensureRoot, saveBuffer, readStream, stat, unlink, walk };