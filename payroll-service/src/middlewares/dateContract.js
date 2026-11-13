"use strict";
const crypto = require("node:crypto");
const dateFields = new Set(["birthDate", "issueDate", "joinDate", "resignedAt", "workDate", "registerDate", "publishDate", "effectiveDate", "expiryDate", "leaveStartDate", "leaveEndDate", "dueDate"]);
function transform(value, outgoing, key = "") {
  if (value == null) return value;
  if (dateFields.has(key)) {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    const match = outgoing ? /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text) : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (match) return `${match[3]}${outgoing ? "/" : "-"}${match[2]}${outgoing ? "/" : "-"}${match[1]}`;
    return value;
  }
  if (key === "month" && typeof value === "string") {
    const match = outgoing ? /^(\d{4})-(\d{2})$/.exec(value) : /^(\d{2})-(\d{4})$/.exec(value);
    if (match) return `${match[2]}-${match[1]}`;
  }
  if (Array.isArray(value)) return value.map(item => transform(item, outgoing));
  if (typeof value === "object" && !(value instanceof Date) && typeof value.toJSON !== "function") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, transform(item, outgoing, name)]));
  }
  return value;
}
function dateContract(internalToken) {
  return (req, res, next) => {
    const supplied = String(req.headers["x-internal-token"] || ""), expected = String(internalToken || "");
    const internal = supplied && expected && Buffer.byteLength(supplied) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (internal) return next();
    req.body = transform(req.body, false);
    for (const [key, value] of Object.entries(req.query || {})) req.query[key] = transform(value, false, key);
    const json = res.json.bind(res);
    res.json = body => json(transform(body, true));
    next();
  };
}
module.exports = { dateContract, transform };
