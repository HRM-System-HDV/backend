"use strict";

class AppError extends Error {
  constructor(message, code = "INTERNAL_SERVER_ERROR", status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class ValidationError extends AppError {
  constructor(message = "Dữ liệu không hợp lệ") {
    super(message, "VALIDATION_ERROR", 400);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Chưa xác thực") {
    super(message, "UNAUTHORIZED", 401);
  }
}

class NotFoundError extends AppError {
  constructor(message = "Không tìm thấy tài nguyên") {
    super(message, "NOT_FOUND", 404);
  }
}

module.exports = { AppError, ValidationError, UnauthorizedError, NotFoundError };
