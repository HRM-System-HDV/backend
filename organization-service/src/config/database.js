"use strict";
const config = require("./index");
let prisma = null;
// Chỉ dùng memory khi chủ động không cấu hình DB; lỗi DB không được đổi sang kho rỗng.
if (config.databaseUrl) { const {PrismaClient} = require("@prisma/client"); prisma = new PrismaClient(); }
async function connect() { if (prisma) await prisma.$connect(); return {mode:prisma ? "postgres":"memory"}; }
async function disconnect() { if (prisma) await prisma.$disconnect(); }
module.exports = {connect,disconnect,getPrisma:()=>prisma,isMemoryMode:()=>!prisma};