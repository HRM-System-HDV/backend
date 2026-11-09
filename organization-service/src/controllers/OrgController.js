"use strict";

const OrgService = require("../services/OrgService");
const { validateBranch, validateDepartment, validateEmployee } = require("../validators/orgValidator");
const { ValidationError, NotFoundError, ForbiddenError } = require("../utils/errors");
const {
  callerFrom,
  isSelf,
  redactEmployee,
  scopeEmployeeQuery,
  assertCanReadEmployee,
  assertCanWriteEmployee,
} = require("../utils/employeeAccess");

async function listBranches(_req, res, next) {
  try {
    const rows = await OrgService.listBranches();
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getBranch(req, res, next) {
  try {
    const row = await OrgService.getBranch(req.params.slug);
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createBranch(req, res, next) {
  try {
    const errors = validateBranch(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await OrgService.createBranch(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateBranch(req, res, next) {
  try {
    const row = await OrgService.updateBranch(req.params.slug, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy chi nhánh");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteBranch(req, res, next) {
  try {
    const ok = await OrgService.removeBranch(req.params.slug);
    if (!ok) throw new NotFoundError("Không tìm thấy chi nhánh");
    return res.status(200).json({ data: { ok: true }, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listDepartments(_req, res, next) {
  try {
    const rows = await OrgService.listDepartments();
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getDepartment(req, res, next) {
  try {
    const row = await OrgService.getDepartment(req.params.id);
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createDepartment(req, res, next) {
  try {
    const errors = validateDepartment(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await OrgService.createDepartment(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateDepartment(req, res, next) {
  try {
    const row = await OrgService.updateDepartment(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy phòng ban");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteDepartment(req, res, next) {
  try {
    const ok = await OrgService.removeDepartment(req.params.id);
    if (!ok) throw new NotFoundError("Không tìm thấy phòng ban");
    return res.status(200).json({ data: { ok: true }, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listEmployees(req, res, next) {
  try {
    const caller = callerFrom(req);
    const rows = await OrgService.listEmployees(scopeEmployeeQuery(req.query, caller));
    return res.status(200).json({
      data: rows.map((row) => redactEmployee(row, caller)),
      message: "Thao tác thành công",
    });
  } catch (e) {
    return next(e);
  }
}

async function getEmployee(req, res, next) {
  try {
    const caller = callerFrom(req);
    const row = await OrgService.getEmployee(req.params.id);
    assertCanReadEmployee(row, caller);
    return res.status(200).json({ data: redactEmployee(row, caller), message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createEmployee(req, res, next) {
  try {
    const errors = validateEmployee(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await OrgService.createEmployee(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateEmployee(req, res, next) {
  try {
    const errors = validateEmployee(req.body, true);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const caller = callerFrom(req);
    const existing = await OrgService.getEmployee(req.params.id);
    const payload = assertCanWriteEmployee(existing, caller, req.body);
    const row = await OrgService.updateEmployee(req.params.id, payload);
    if (!row) {
      const err = new NotFoundError("Không tìm thấy thông tin nhân sự trên hệ thống");
      err.code = "EMPLOYEE_NOT_FOUND";
      throw err;
    }
    return res.status(200).json({ data: redactEmployee(row, caller), message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteEmployee(req, res, next) {
  try {
    const targetId = req.params.id;
    const currentUserId = req.headers["x-user-id"];
    const currentUserEmail = req.headers["x-user-email"];

    if (currentUserId && (targetId === currentUserId || targetId.toLowerCase() === String(currentUserId).toLowerCase())) {
      const err = new ForbiddenError("Không được phép tự xóa tài khoản của chính mình đang đăng nhập");
      err.code = "CANNOT_DELETE_SELF";
      throw err;
    }

    const emp = await OrgService.getEmployee(targetId);
    if (!emp) {
      const err = new NotFoundError("Không tìm thấy thông tin nhân sự trên hệ thống");
      err.code = "EMPLOYEE_NOT_FOUND";
      throw err;
    }

    if (currentUserEmail && emp.email && emp.email.toLowerCase() === String(currentUserEmail).toLowerCase()) {
      const err = new ForbiddenError("Không được phép tự xóa tài khoản của chính mình đang đăng nhập");
      err.code = "CANNOT_DELETE_SELF";
      throw err;
    }

    const ok = await OrgService.removeEmployee(targetId);
    if (!ok) {
      const err = new NotFoundError("Không tìm thấy thông tin nhân sự trên hệ thống");
      err.code = "EMPLOYEE_NOT_FOUND";
      throw err;
    }
    return res.status(200).json({ data: { ok: true }, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function leaveEmployee(req, res, next) {
  try {
    const caller = callerFrom(req);
    const existing = await OrgService.getEmployee(req.params.id);
    if (caller.role !== "admin" && !isSelf(existing, caller)) {
      throw new ForbiddenError("Bạn chỉ được xác nhận thôi việc cho chính mình");
    }
    const row = await OrgService.updateEmployee(req.params.id, {
      status: "resigned",
      resignedAt: new Date().toISOString(),
    });
    if (!row) {
      const err = new NotFoundError("Không tìm thấy thông tin nhân sự trên hệ thống");
      err.code = "EMPLOYEE_NOT_FOUND";
      throw err;
    }
    return res.status(200).json({ data: row, message: "Nhân viên đã xác nhận thôi việc" });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  leaveEmployee,
};
