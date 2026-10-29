"use strict";

const database = require("../config/database");
const { SEED_REGULATIONS } = require("../../prisma/seed");

let memoryRegulations = JSON.parse(JSON.stringify(SEED_REGULATIONS)).map((r) => ({
  ...r,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function findMany() {
  const prisma = database.getPrisma();
  if (!prisma) {
    return [...memoryRegulations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }
  return prisma.regulation.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
}

async function findById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryRegulations.find((r) => r.id === id) || null;
  }
  return prisma.regulation.findUnique({ where: { id } });
}

async function create(data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const newItem = {
      id: data.id || `reg-${Date.now()}`,
      status: "hiệu lực",
      scope: "Toàn công ty",
      version: "1.0",
      pinned: false,
      attachments: 0,
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryRegulations.unshift(newItem);
    return newItem;
  }
  return prisma.regulation.create({ data });
}

async function update(id, data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryRegulations.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    memoryRegulations[idx] = { ...memoryRegulations[idx], ...data, updatedAt: new Date() };
    return memoryRegulations[idx];
  }
  return prisma.regulation.update({ where: { id }, data });
}

async function deleteById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryRegulations.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    memoryRegulations.splice(idx, 1);
    return true;
  }
  await prisma.regulation.delete({ where: { id } });
  return true;
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  deleteById,
};
