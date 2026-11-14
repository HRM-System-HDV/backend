"use strict";
const { ValidationError } = require("../utils/errors");
function uuid(value, label = "id") { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ValidationError(`${label} phải là UUID`); return value.toLowerCase(); }
function month(value) { if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ValidationError("Kỳ lương phải đúng YYYY-MM"); return value; }
function money(value, label) { const text = String(value); if (!/^\d+$/.test(text) || text.length > 15) throw new ValidationError(`${label} phải là số tiền VNĐ không âm, tối đa 15 chữ số`); return text.replace(/^0+(?=\d)/, ""); }
module.exports = { uuid, month, money };
