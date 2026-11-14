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

class ForbiddenError extends Error {
  constructor(message) {
    super(message || "Không có quyền thực hiện thao tác này");
    this.name = "ForbiddenError";
    this.status = 403;
    this.code = "FORBIDDEN";
  }
}

class InternalServerError extends Error {
  constructor(message) {
    super(message || "Lỗi hệ thống");
    this.name = "InternalServerError";
    this.status = 500;
    this.code = "INTERNAL_SERVER_ERROR";
  }
}

module.exports = { ValidationError, NotFoundError, ForbiddenError, DuplicateError, InsufficientFundsError, InternalServerError };
