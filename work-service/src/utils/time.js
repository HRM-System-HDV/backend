"use strict";
const { ValidationError } = require("./errors");
const OFFSET = 7 * 60 * 60 * 1000;
function day(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new ValidationError("Ngày phải hợp lệ theo YYYY-MM-DD");
  return text;
}
function date(value) { return new Date(`${day(value)}T00:00:00Z`); }
function today() { return new Date(Date.now() + OFFSET).toISOString().slice(0, 10); }
function clock(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new ValidationError("Giờ phải hợp lệ theo HH:mm");
  return value;
}
function bounds(shift) {
  const key = day(shift.workDate);
  const start = new Date(`${key}T${clock(shift.scheduledStart)}:00+07:00`);
  let end = new Date(`${key}T${clock(shift.scheduledEnd)}:00+07:00`);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ValidationError("Mốc thời gian phải là ISO có múi giờ");
  return new Date(value);
}
function month(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) throw new ValidationError("Kỳ phải theo YYYY-MM");
  return String(value);
}
module.exports = { day, date, today, clock, bounds, timestamp, month };
