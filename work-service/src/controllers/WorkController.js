"use strict";

const WorkService = require("../services/WorkService");
const { validateShift, validateTask, validateAttendance } = require("../validators/workValidator");
const { ValidationError, NotFoundError } = require("../utils/errors");

async function listShifts(req, res, next) {
  try {
    const rows = await WorkService.listShifts(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createShift(req, res, next) {
  try {
    const errors = validateShift(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.createShift(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateShift(req, res, next) {
  try {
    const row = await WorkService.updateShift(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteShift(req, res, next) {
  try {
    const ok = await WorkService.deleteShift(req.params.id);
    if (!ok) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: { ok: true }, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function assignShift(req, res, next) {
  try {
    if (!req.body.employeeId) throw new ValidationError("Thiếu employeeId để phân công");
    const row = await WorkService.updateShift(req.params.id, { employeeId: req.body.employeeId });
    if (!row) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: row, message: "Phân công ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function registerShift(req, res, next) {
  try {
    if (!req.body.employeeId) throw new ValidationError("Thiếu employeeId để đăng ký ca");
    const row = await WorkService.registerShift(req.body);
    return res.status(201).json({ data: row, message: "Đăng ký ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listRegistrations(req, res, next) {
  try {
    const rows = await WorkService.listRegistrations(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function checkin(req, res, next) {
  try {
    const errors = validateAttendance(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.checkin(req.body);
    return res.status(201).json({ data: row, message: "Chấm công vào thành công" });
  } catch (e) {
    return next(e);
  }
}

async function checkout(req, res, next) {
  try {
    const errors = validateAttendance(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.checkout(req.body);
    return res.status(200).json({ data: row, message: "Chấm công ra thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listAttendance(req, res, next) {
  try {
    const rows = await WorkService.listAttendance(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getConfig(_req, res, next) {
  try {
    const cfg = await WorkService.getConfig();
    return res.status(200).json({ data: cfg, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateConfig(req, res, next) {
  try {
    const cfg = await WorkService.updateConfig(req.body);
    return res.status(200).json({ data: cfg, message: "Cập nhật cấu hình thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listTasks(req, res, next) {
  try {
    const rows = await WorkService.listTasks(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createTask(req, res, next) {
  try {
    const errors = validateTask(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.createTask(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateTask(req, res, next) {
  try {
    const errors = validateTask({ title: "x", ...req.body });
    if (errors.length && !req.body.title) {
      // Cho phép update từng phần, chỉ check status
      if (req.body.status && !["pending", "in_progress", "done"].includes(req.body.status)) {
        throw new ValidationError(errors.join("; "));
      }
    } else if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.updateTask(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy tác vụ");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteTask(req, res, next) {
  try {
    const ok = await WorkService.deleteTask(req.params.id);
    if (!ok) throw new NotFoundError("Không tìm thấy tác vụ");
    return res.status(200).json({ data: { ok: true }, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getShift(req, res, next) {
  try {
    const row = await WorkService.getShiftById(req.params.id);
    if (!row) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getTask(req, res, next) {
  try {
    const row = await WorkService.getTaskById(req.params.id);
    if (!row) throw new NotFoundError("Không tìm thấy tác vụ");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listTemplates(_req, res, next) {
  try {
    const rows = await WorkService.listTemplates();
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createTemplate(req, res, next) {
  try {
    if (!req.body.name || !req.body.startTime || !req.body.endTime) {
      throw new ValidationError("Thiếu name, startTime hoặc endTime");
    }
    const row = await WorkService.createTemplate({
      name: req.body.name,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
    });
    return res.status(201).json({ data: row, message: "Tạo khung ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const row = await WorkService.updateTemplate(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy khung ca");
    return res.status(200).json({ data: row, message: "Cập nhật khung ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const ok = await WorkService.deleteTemplate(req.params.id);
    if (!ok) throw new NotFoundError("Không tìm thấy khung ca");
    return res.status(200).json({ data: { ok: true }, message: "Xóa khung ca thành công" });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
  assignShift,
  registerShift,
  listRegistrations,
  getShift,
  checkin,
  checkout,
  listAttendance,
  getConfig,
  updateConfig,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  getTask,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
