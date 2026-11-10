"use strict";

// Chuẩn ngày toàn dự án: DD/MM/YYYY; ngày kèm giờ: DD/MM/YYYY HH:mm.

function pad(n) {
  return String(n).padStart(2, "0");
}

function partsFromDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return {
    day: d.getDate(),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    hasTime: d.getHours() !== 0 || d.getMinutes() !== 0,
  };
}

function valid(p) {
  return (
    p &&
    Number.isInteger(p.day) &&
    Number.isInteger(p.month) &&
    Number.isInteger(p.year) &&
    p.day >= 1 &&
    p.day <= 31 &&
    p.month >= 1 &&
    p.month <= 12 &&
    p.year >= 1900 &&
    p.year <= 2999
  );
}

// Nhận diện mọi định dạng đang lưu trong hệ thống:
// ISO (2026-10-02 / 2026-10-02T14:05:00), DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
// kèm giờ HH:mm hoặc HH:mm:ss. Trả về null nếu không phải ngày.
function parseParts(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date) return partsFromDate(raw);

  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (m) {
    const p = {
      day: Number(m[3]),
      month: Number(m[2]),
      year: Number(m[1]),
      hour: m[4] !== undefined ? Number(m[4]) : 0,
      minute: m[5] !== undefined ? Number(m[5]) : 0,
      hasTime: m[4] !== undefined,
    };
    return valid(p) ? p : null;
  }

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (m) {
    const p = {
      day: Number(m[1]),
      month: Number(m[2]),
      year: Number(m[3]),
      hour: m[4] !== undefined ? Number(m[4]) : 0,
      minute: m[5] !== undefined ? Number(m[5]) : 0,
      hasTime: m[4] !== undefined,
    };
    return valid(p) ? p : null;
  }

  const d = new Date(s);
  return partsFromDate(d);
}

function formatParts(p) {
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

function toVnDate(raw) {
  const p = parseParts(raw);
  return p ? formatParts(p) : null;
}

function toVnDateTime(raw) {
  const p = parseParts(raw);
  if (!p) return null;
  const date = formatParts(p);
  return p.hasTime ? `${date} ${pad(p.hour)}:${pad(p.minute)}` : date;
}

// Ngày local từ chuỗi; dùng cho so sánh/tính toán. null nếu không hợp lệ.
function parseDate(raw) {
  const p = parseParts(raw);
  if (!p) return null;
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
}

// Khóa YYYYMMDD để so sánh/sắp xếp chuỗi ngày DD/MM/YYYY.
function dateKey(raw) {
  const p = parseParts(raw);
  return p ? `${p.year}${pad(p.month)}${pad(p.day)}` : "";
}

// Tháng dạng YYYY-MM hoặc MM/YYYY -> { yy: "YYYY", mon: "MM" }.
function monthKey(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { yy: m[1], mon: pad(Number(m[2])) };
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return { yy: m[2], mon: pad(Number(m[1])) };
  return null;
}

function todayVn() {
  return formatParts(partsFromDate(new Date()));
}

module.exports = {
  parseParts,
  toVnDate,
  toVnDateTime,
  parseDate,
  dateKey,
  monthKey,
  todayVn,
};
