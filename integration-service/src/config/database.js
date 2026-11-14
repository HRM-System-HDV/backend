"use strict";

const config = require("./index");

let prisma = null;
let useMemory = false;

try {
  // eslint-disable-next-line global-require
  const { PrismaClient } = require("@prisma/client");
  if (!config.databaseUrl) {
    useMemory = true;
  } else {
    prisma = new PrismaClient();
  }
} catch (e) {
  if (config.databaseUrl) throw e;
  useMemory = true;
}

async function connect() {
  if (useMemory || !prisma) {
    console.log("[integration-service] DATABASE_URL trống hoặc thiếu client -> dùng kho in-memory");
    return { mode: "memory" };
  }
  await prisma.$connect();
  return { mode: "postgres" };
}

async function disconnect() {
  if (prisma) {
    await prisma.$disconnect().catch(() => {});
  }
}

function getPrisma() {
  return useMemory ? null : prisma;
}

function isMemoryMode() {
  return useMemory || !prisma;
}

module.exports = { connect, disconnect, getPrisma, isMemoryMode };
