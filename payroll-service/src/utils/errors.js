"use strict";

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.code = "VALIDATION_ERROR";
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message || "Không tìm thấy tài nguyên");
    this.name = "NotFoundError";
    this.status = 404;
    this.code = "NOT_FOUND";
  }
}

class DuplicateError extends Error {
  constructor(message) {
    super(message || "Tài nguyên đã tồn tại");
    this.name = "DuplicateError";
    this.status = 409;
    this.code = "DUPLICATE_RESOURCE";
  }
}

class InsufficientFundsError extends Error {
  constructor(message) {
    super(message || "Số dư không đủ");
    this.name = "InsufficientFundsError";
    this.status = 422;
    this.code = "INSUFFICIENT_FUNDS";
  }
}

module.exports = { ValidationError, NotFoundError, DuplicateError, InsufficientFundsError };
