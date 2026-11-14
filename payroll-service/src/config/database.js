"use strict";
const config = require("./index");
let prisma = null;
if (config.databaseUrl) { const { PrismaClient } = require("@prisma/client"); prisma = new PrismaClient(); }
async function connect() { if (!prisma) return { mode: "memory" }; await prisma.$connect(); return { mode: "postgres" }; }
async function disconnect() { if (prisma) await prisma.$disconnect(); }
module.exports = { connect, disconnect, getPrisma: () => prisma, isMemoryMode: () => !prisma };