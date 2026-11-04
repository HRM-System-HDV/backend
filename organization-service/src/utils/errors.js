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

class ForbiddenError extends Error {
  constructor(message) {
    super(message || "Không có quyền thực hiện thao tác");
    this.name = "ForbiddenError";
    this.status = 403;
    this.code = "FORBIDDEN";
  }
}

module.exports = { ValidationError, NotFoundError, DuplicateError, ForbiddenError };
