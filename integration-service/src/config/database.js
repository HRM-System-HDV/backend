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
  useMemory = true;
}

async function connect() {
  if (useMemory || !prisma) {
    console.log("[integration-service] DATABASE_URL trống hoặc thiếu client -> dùng kho in-memory");
    return { mode: "memory" };
  }
  try {
    await prisma.$connect();
    console.log("[integration-service] Đã kết nối Postgres Supabase (hrm_integration)");
    return { mode: "postgres" };
  } catch (error) {
    console.warn("[integration-service] Không kết nối được Postgres, fallback memory:", error.message);
    useMemory = true;
    prisma = null;
    return { mode: "memory" };
  }
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
