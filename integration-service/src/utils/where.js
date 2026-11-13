"use strict";

// Bộ lọc tối giản theo cú pháp Prisma `where`, dùng cho kho in-memory khi không có
// DATABASE_URL. Chỉ hỗ trợ đúng các toán tử service đang dùng: so sánh bằng,
// `null` (NULL), `in`, `not`/`notIn` và nhóm `AND`/`OR`/`NOT`.
// Mục tiêu: điều kiện lọc viết trong Service phải giống nhau cho cả Postgres
// (Prisma) và in-memory, để phạm vi chi nhánh luôn được áp dụng ở tầng truy vấn.

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function matchValue(actual, expected) {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected)) return expected.some(item => matchValue(actual, item));
  if (isPlainObject(expected)) {
    if (Array.isArray(expected.in)) return expected.in.some(item => matchValue(actual, item));
    if (Array.isArray(expected.notIn)) return !expected.notIn.some(item => matchValue(actual, item));
    if ("not" in expected) return !matchValue(actual, expected.not);
    return false;
  }
  return actual === expected;
}

function matchesWhere(row, where) {
  if (!where || !isPlainObject(where)) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every(clause => matchesWhere(row, clause));
    if (key === "OR") return value.some(clause => matchesWhere(row, clause));
    if (key === "NOT") return !value.every(clause => matchesWhere(row, clause));
    return matchValue(row[key], value);
  });
}

module.exports = { matchesWhere };
