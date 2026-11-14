"use strict";

const pino = require("pino");

const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

function formatMessage(msg, args) {
  if (args.length === 0) return msg;
  return [msg, ...args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))].join(" ");
}

const logger = {
  info: (msgOrObj, ...args) => {
    if (typeof msgOrObj === "object" && msgOrObj !== null) {
      baseLogger.info(msgOrObj, ...args);
    } else {
      baseLogger.info(formatMessage(msgOrObj, args));
    }
  },
  warn: (msgOrObj, ...args) => {
    if (typeof msgOrObj === "object" && msgOrObj !== null) {
      baseLogger.warn(msgOrObj, ...args);
    } else {
      baseLogger.warn(formatMessage(msgOrObj, args));
    }
  },
  error: (msgOrObj, ...args) => {
    if (typeof msgOrObj === "object" && msgOrObj !== null) {
      baseLogger.error(msgOrObj, ...args);
    } else {
      baseLogger.error(formatMessage(msgOrObj, args));
    }
  },
  debug: (msgOrObj, ...args) => {
    if (typeof msgOrObj === "object" && msgOrObj !== null) {
      baseLogger.debug(msgOrObj, ...args);
    } else {
      baseLogger.debug(formatMessage(msgOrObj, args));
    }
  },
  child: (bindings) => baseLogger.child(bindings),
  pino: baseLogger,
};

module.exports = logger;
