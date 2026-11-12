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

class InternalServerError extends Error {
  constructor(message, cause) {
    super(message || "Lỗi hệ thống");
    this.name = "InternalServerError";
    this.status = 500;
    this.code = "INTERNAL_SERVER_ERROR";
    if (cause) this.cause = cause;
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

class ConflictError extends Error {
  constructor(message = "Dữ liệu đã tồn tại hoặc vừa thay đổi, vui lòng tải lại") {
    super(message); this.status = 409; this.code = "DUPLICATE_RESOURCE";
  }
}
module.exports = { ValidationError, NotFoundError, ForbiddenError, InternalServerError, ConflictError };
