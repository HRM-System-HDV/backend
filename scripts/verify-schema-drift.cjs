"use strict";

// Kiểm tra nợ drift của ràng buộc CHECK và partial unique index.
//
// Prisma không biểu diễn được CHECK/partial unique trong schema.prisma, nên các ràng
// buộc này chỉ tồn tại trong file migration.sql. Một lần `prisma migrate dev` hoặc
// `prisma migrate diff` bất cẩn sẽ sinh migration DROP toàn bộ ràng buộc đó.
//
// Script này đối chiếu 3 nguồn cho mỗi service:
//   1. file migration.sql trong repo (nơi ràng buộc được khai báo)
//   2. DB thật (ràng buộc còn tồn tại sau khi deploy không)
//   3. schema.prisma (ràng buộc có được Prisma biết hay không)
//
// Cách dùng:  npm.cmd run prisma:check   (tại thư mục backend/)
// Exit code khác 0 nếu có ràng buộc bị mất trên DB thật.

const fs = require("node:fs");
const path = require("node:path");

const services = ["identity-service", "organization-service", "work-service", "payroll-service", "integration-service"];
const root = path.resolve(__dirname, "..");

function readMigrationSql(serviceDir) {
  const migrationsDir = path.join(serviceDir, "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) return "";
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => fs.readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"))
    .join("\n");
}

// CHECK constraint, cả hai dạng:
//   CONSTRAINT "ten" CHECK (...)                                  (khai báo trong CREATE TABLE)
//   ALTER TABLE ... ADD CONSTRAINT "ten" CHECK (...)              (thêm sau)
function parseCheckConstraints(sql) {
  const names = new Set();
  const inline = /CONSTRAINT\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+CHECK\s*\(/gi;
  const added = /ADD\s+CONSTRAINT\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+CHECK\s*\(/gi;
  const push = (match) => names.add(match[1] || match[2]);
  let match;
  while ((match = inline.exec(sql))) push(match);
  while ((match = added.exec(sql))) push(match);
  return names;
}

// Partial unique index: CREATE UNIQUE INDEX "ten" ... WHERE ...
function parsePartialUniqueIndexes(sql) {
  const names = new Set();
  const pattern = /CREATE\s+UNIQUE\s+INDEX\s+"([^"]+)"[^;]*?\bWHERE\b/gi;
  let match;
  while ((match = pattern.exec(sql))) names.add(match[1]);
  return names;
}

async function readLiveConstraints(prisma) {
  const checks = await prisma.$queryRawUnsafe(`
    SELECT c.conname AS name
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'c' AND n.nspname = 'public'
  `);
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE '%UNIQUE%WHERE%'
  `);
  return {
    checks: new Set(checks.map(row => row.name)),
    partialUniqueIndexes: new Set(indexes.map(row => row.name)),
  };
}

(async () => {
  let problems = 0;
  let warnings = 0;

  for (const service of services) {
    const serviceDir = path.join(root, service);
    const envFile = path.join(serviceDir, ".env");
    const env = fs.existsSync(envFile)
      ? require(path.join(serviceDir, "node_modules/dotenv")).parse(fs.readFileSync(envFile))
      : {};
    const url = env.DATABASE_URL || process.env.DATABASE_URL;
    const sql = readMigrationSql(serviceDir);
    const declaredChecks = parseCheckConstraints(sql);
    const declaredPartial = parsePartialUniqueIndexes(sql);

    if (!url) {
      console.log(`${service}: bỏ qua kiểm tra DB (không có DATABASE_URL)`);
      continue;
    }

    const { PrismaClient } = require(path.join(serviceDir, "node_modules/@prisma/client"));
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const live = await readLiveConstraints(db);
      const missingChecks = [...declaredChecks].filter(name => !live.checks.has(name));
      const missingIndexes = [...declaredPartial].filter(name => !live.partialUniqueIndexes.has(name));

      if (missingChecks.length || missingIndexes.length) {
        problems += missingChecks.length + missingIndexes.length;
        console.log(`${service}: THIẾU trên DB thật -> CHECK [${missingChecks.join(", ")}] INDEX [${missingIndexes.join(", ")}]`);
      } else {
        console.log(
          `${service}: OK — ${declaredChecks.size} CHECK và ${declaredPartial.size} partial unique index còn nguyên trên DB thật`,
        );
      }

      const schemaFile = path.join(serviceDir, "prisma", "schema.prisma");
      const schema = fs.readFileSync(schemaFile, "utf8");
      const representable = [...declaredChecks].filter(name => schema.includes(name)).length;
      if (representable < declaredChecks.size) {
        warnings += declaredChecks.size - representable;
        console.log(
          `${service}: LƯU Ý nợ drift — ${declaredChecks.size - representable}/${declaredChecks.size} CHECK không biểu diễn được trong schema.prisma. ` +
            "Cấm `prisma migrate dev`/`migrate diff` trên DB có dữ liệu, chỉ dùng `migrate deploy`.",
        );
      }
    } finally {
      await db.$disconnect();
    }
  }

  if (problems) {
    console.error(`\n${problems} ràng buộc đã mất trên DB thật. Phải deploy lại migration tương ứng trước khi dùng.`);
    process.exitCode = 1;
    return;
  }
  if (warnings) {
    console.log(`\n${warnings} ràng buộc chỉ tồn tại trong migration.sql (nợ drift) — nhớ chỉ dùng migrate deploy.`);
  }
})().catch(error => {
  console.error(error.code || error.name, error.message);
  process.exitCode = 1;
});
