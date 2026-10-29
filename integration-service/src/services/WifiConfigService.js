"use strict";

const database = require("../config/database");
const { SEED_WIFI_CONFIGS } = require("../../prisma/seed");

let memoryWifi = JSON.parse(JSON.stringify(SEED_WIFI_CONFIGS)).map((w) => ({
  ...w,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function findMany({ branch } = {}) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryWifi.filter((w) => {
      if (branch && w.branch.toLowerCase() !== branch.toLowerCase()) return false;
      return true;
    });
  }
  const where = branch ? { branch: { equals: branch, mode: "insensitive" } } : {};
  return prisma.wifiConfig.findMany({ where, orderBy: { createdAt: "desc" } });
}

async function findById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryWifi.find((w) => w.id === id) || null;
  }
  return prisma.wifiConfig.findUnique({ where: { id } });
}

async function create(data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const newItem = {
      id: data.id || `wf-${Date.now()}`,
      status: "hoạt động",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryWifi.unshift(newItem);
    return newItem;
  }
  return prisma.wifiConfig.create({ data });
}

async function update(id, data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryWifi.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    memoryWifi[idx] = { ...memoryWifi[idx], ...data, updatedAt: new Date() };
    return memoryWifi[idx];
  }
  return prisma.wifiConfig.update({ where: { id }, data });
}

async function deleteById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryWifi.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    memoryWifi.splice(idx, 1);
    return true;
  }
  await prisma.wifiConfig.delete({ where: { id } });
  return true;
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  deleteById,
};
