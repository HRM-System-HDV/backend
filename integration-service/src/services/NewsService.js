"use strict";

const database = require("../config/database");
const { SEED_NEWS } = require("../../prisma/seed");

let memoryNews = JSON.parse(JSON.stringify(SEED_NEWS)).map((n) => ({
  ...n,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

async function findMany() {
  const prisma = database.getPrisma();
  if (!prisma) {
    return [...memoryNews].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }
  return prisma.news.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
}

async function findById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    return memoryNews.find((n) => n.id === id) || null;
  }
  return prisma.news.findUnique({ where: { id } });
}

async function create(data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const newItem = {
      id: data.id || `news-${Date.now()}`,
      pinned: false,
      tagTone: "primary",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memoryNews.unshift(newItem);
    return newItem;
  }
  return prisma.news.create({ data });
}

async function update(id, data) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryNews.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    memoryNews[idx] = { ...memoryNews[idx], ...data, updatedAt: new Date() };
    return memoryNews[idx];
  }
  return prisma.news.update({ where: { id }, data });
}

async function deleteById(id) {
  const prisma = database.getPrisma();
  if (!prisma) {
    const idx = memoryNews.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    memoryNews.splice(idx, 1);
    return true;
  }
  await prisma.news.delete({ where: { id } });
  return true;
}

module.exports = {
  findMany,
  findById,
  create,
  update,
  deleteById,
};
