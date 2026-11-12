"use strict";

const WorkService = require("../services/WorkService");
const { validateShift, validateTask, validateAttendance } = require("../validators/workValidator");
const { ValidationError, NotFoundError, ForbiddenError } = require("../utils/errors");
const {
  callerFrom,
  isPrivileged,
  assertSelfEmployee,
  scopeOwnQuery,
  scopeTaskQuery,
  scopeBranchQuery,
  assertBranchScope,
} = require("../utils/caller");

// Quản lý chỉ được chấm công hộ cho ca thuộc chi nhánh của mình. Khi không
// có shiftId thì không có dữ liệu để đối chiếu nên giữ hành vi cũ.
async function assertAttendanceBranchScope(shiftId, caller) {
  if (caller.role !== "manager" || !shiftId) return;
  const shift = await WorkService.getShiftById(shiftId);
  if (!shift) return;
  assertBranchScope(
    shift,
    caller,
    "Quản lý chỉ được chấm công cho ca thuộc chi nhánh của mình",
  );
}

async function listShifts(req, res, next) {
  try {
    const rows = await WorkService.listShifts(scopeBranchQuery(req.query, callerFrom(req)));
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createShift(req, res, next) {
  try {
    const errors = validateShift(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const caller = callerFrom(req);
    const payload = { ...req.body };
    if (caller.role === "manager") {
      // Quản lý chỉ được tạo ca trong chi nhánh của mình.
      if (!caller.branchSlug) {
        throw new ForbiddenError("Tài khoản quản lý chưa được gán chi nhánh");
      }
      payload.branchSlug = caller.branchSlug;
    }
    const row = await WorkService.createShift(payload);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateShift(req, res, next) {
  try {
    const caller = callerFrom(req);
    if (caller.role === "manager") {
      const current = await WorkService.getShiftById(req.params.id);
      if (!current) throw new NotFoundError("Không tìm thấy ca làm việc");
      assertBranchScope(current, caller, "Quản lý chỉ được sửa ca thuộc chi nhánh của mình");
    }
    const row = await WorkService.updateShift(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteShift(req, res, next) {
  try {
    const caller = callerFrom(req);
    if (caller.role === "manager") {
      const current = await WorkService.getShiftById(req.params.id);
      if (!current) throw new NotFoundError("Không tìm thấy ca làm việc");
      assertBranchScope(current, caller, "Quản lý chỉ được xóa ca thuộc chi nhánh của mình");
    }
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
    const caller = callerFrom(req);
    if (caller.role === "manager") {
      const current = await WorkService.getShiftById(req.params.id);
      if (!current) throw new NotFoundError("Không tìm thấy ca làm việc");
      assertBranchScope(current, caller, "Quản lý chỉ được phân công ca thuộc chi nhánh của mình");
    }
    const row = await WorkService.updateShift(req.params.id, { employeeId: req.body.employeeId });
    if (!row) throw new NotFoundError("Không tìm thấy ca làm việc");
    return res.status(200).json({ data: row, message: "Phân công ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function registerShift(req, res, next) {
  try {
    const body = assertSelfEmployee(req.body, callerFrom(req));
    if (!body.employeeId) throw new ValidationError("Thiếu employeeId để đăng ký ca");
    const row = await WorkService.registerShift(body);
    return res.status(201).json({ data: row, message: "Đăng ký ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function unregisterShift(req, res, next) {
  try {
    const body = assertSelfEmployee(req.body, callerFrom(req));
    const { employeeId, shiftId, week, preference } = body;
    if (!employeeId) throw new ValidationError("Thiếu employeeId để hủy đăng ký ca");
    const removed = await WorkService.unregisterShift({
      employeeId,
      shiftId,
      week: week || preference,
    });
    if (!removed) throw new NotFoundError("Không có đăng ký ca nào để hủy");
    return res.status(200).json({ data: { ok: true }, message: "Hủy đăng ký ca thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listRegistrations(req, res, next) {
  try {
    const rows = await WorkService.listRegistrations(scopeOwnQuery(req.query, callerFrom(req)));
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteRegistration(req, res, next) {
  try {
    const caller = callerFrom(req);
    if (!isPrivileged(caller)) {
      const mine = await WorkService.listRegistrations(scopeOwnQuery({}, caller));
      if (!mine.some((r) => String(r.id) === String(req.params.id))) {
        throw new ForbiddenError("Bạn không có quyền xóa đăng ký ca của người khác");
      }
    }
    const success = await WorkService.deleteRegistration(req.params.id);
    if (!success) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Bản ghi đăng ký không tồn tại" } });
    }
    return res.status(200).json({ message: "Xóa đăng ký thành công" });
  } catch (e) {
    return next(e);
  }
}

async function checkin(req, res, next) {
  try {
    const caller = callerFrom(req);
    const body = assertSelfEmployee(req.body, caller);
    await assertAttendanceBranchScope(body.shiftId, caller);
    const errors = validateAttendance(body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.checkin(body);
    return res.status(201).json({ data: row, message: "Chấm công vào thành công" });
  } catch (e) {
    return next(e);
  }
}

// Chốt ra quá cửa sổ (ca đã bị bỏ qua): nhân viên bị WorkService chặn bằng 400, còn
// admin/manager được chốt hộ qua chính tuyến này — assertSelfEmployee đã trả nguyên
// body cho caller đặc quyền nên không cần endpoint "chấm công hộ" riêng. `caller`
// chuyển xuống service để giới hạn manager đúng chi nhánh từ header gateway ký.
async function checkout(req, res, next) {
  try {
    const caller = callerFrom(req);
    const body = assertSelfEmployee(req.body, caller);
    await assertAttendanceBranchScope(body.shiftId, caller);
    const errors = validateAttendance(body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await WorkService.checkout({ ...body, caller });
    return res.status(200).json({ data: row, message: "Chấm công ra thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listAttendance(req, res, next) {
  try {
    const caller = callerFrom(req);
    // actor lấy từ header do gateway ký, không bao giờ từ req.query.
    const rows = await WorkService.listAttendance({
      ...scopeOwnQuery(req.query, caller),
      actor: caller.userId,
    });
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
    const rows = await WorkService.listTasks(scopeTaskQuery(req.query, callerFrom(req)));
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
      if (req.body.status && !["pending", "in_progress", "inProgress", "done", "completed", "overdue"].includes(req.body.status)) {
        throw new ValidationError(errors.join("; "));
      }
    } else if (errors.length) throw new ValidationError(errors.join("; "));
    const caller = callerFrom(req);
    let payload = req.body;
    if (!isPrivileged(caller)) {
      const task = await WorkService.getTaskById(req.params.id);
      if (!task) throw new NotFoundError("Không tìm thấy tác vụ");
      const mine = String(task.assignedTo || "") === String(caller.userId);
      // Nhiệm vụ theo ca giao cho cả ca nên không có một người nhận cụ thể:
      // nhân viên cùng chi nhánh vẫn được báo cáo tiến độ việc này.
      const shiftTaskOfBranch =
        !task.assignedTo &&
        task.sourceType === "shift" &&
        !!caller.branchSlug &&
        String(task.branchSlug || "").toLowerCase() === String(caller.branchSlug).toLowerCase();
      if (!mine && !shiftTaskOfBranch) {
        throw new ForbiddenError("Bạn không có quyền cập nhật tác vụ của người khác");
      }
      // Nhân viên chỉ báo cáo tiến độ, không tự giao việc hay đổi hạn.
      payload = {};
      for (const field of ["status", "completedAt", "proofPhotoUrl"]) {
        if (req.body[field] !== undefined) payload[field] = req.body[field];
      }
    }
    const row = await WorkService.updateTask(req.params.id, payload);
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
  unregisterShift,
  listRegistrations,
  deleteRegistration,
  checkin,
  checkout,
  listAttendance,
  getConfig,
  updateConfig,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
