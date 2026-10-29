"use strict";

// Kết nối DB qua Prisma cho identity-service.
// QUAN TRỌNG: đây là service xác thực nên không được âm thầm fallback memory.
// Nếu thiếu DATABASE_URL / không kết nối được Postgres, service sẽ dừng và báo lỗi
// thay vì đăng nhập bằng tài khoản seed trong RAM (tránh cảm giác "login mock").
// Chỉ dùng memory khi test hoặc khi bật rõ ràng ALLOW_MEMORY_FALLBACK=true.
const config = require("./index");

let prisma = null;
let useMemory = false;
let initError = null;

const allowMemoryFallback =
  process.env.ALLOW_MEMORY_FALLBACK === "true" || config.nodeEnv === "test";

try {
  // eslint-disable-next-line global-require
  const { PrismaClient } = require("@prisma/client");
  if (!config.databaseUrl) {
    useMemory = true;
    initError = new Error("DATABASE_URL chưa được cấu hình");
  } else {
    prisma = new PrismaClient();
  }
} catch (e) {
  useMemory = true;
  initError = new Error(`Không nạp được Prisma Client: ${e.message}`);
}

async function connect() {
  if (useMemory || !prisma) {
    const message =
      initError?.message || "DATABASE_URL trống hoặc thiếu Prisma Client";
    if (!allowMemoryFallback) {
      throw new Error(
        `[identity-service] Không thể dùng Postgres: ${message}. ` +
          "Đặt ALLOW_MEMORY_FALLBACK=true chỉ khi thực sự muốn chạy memory."
      );
    }
    console.warn(`[identity-service] ${message} -> dùng kho in-memory (đã bật ALLOW_MEMORY_FALLBACK)`);
    return { mode: "memory" };
  }
  try {
    await prisma.$connect();
    console.log("[identity-service] Đã kết nối Postgres");
    return { mode: "postgres" };
  } catch (error) {
    if (!allowMemoryFallback) {
      throw new Error(
        `[identity-service] Không kết nối được Postgres: ${error.message}. ` +
          "Service dừng để tránh đăng nhập bằng dữ liệu seed trong RAM."
      );
    }
    console.warn("[identity-service] Không kết nối được Postgres, fallback memory:", error.message);
    useMemory = true;
    prisma = null;
    return { mode: "memory" };
  }
}

async function disconnect() {
  if (prisma) await prisma.$disconnect().catch(() => {});
}

function getPrisma() {
  return useMemory ? null : prisma;
}

function isMemoryMode() {
  return useMemory || !prisma;
}

function getMode() {
  return isMemoryMode() ? "memory" : "postgres";
}

module.exports = { connect, disconnect, getPrisma, isMemoryMode, getMode };
