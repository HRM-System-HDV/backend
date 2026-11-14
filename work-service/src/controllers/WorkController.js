"use strict";
const WorkService = require("../services/WorkService");
const { callerFrom } = require("../utils/caller");
const execute = (operation, status = 200) => async (req, res, next) => {
  try { const data = await operation(req, callerFrom(req)); return res.status(status).json({ data, message: "Thao tác thành công" }); }
  catch (error) { return next(error); }
};
module.exports = {
  listShifts: execute((req, caller) => WorkService.listShifts(req.query, caller)),
  getShift: execute((req, caller) => WorkService.getShiftById(req.params.id, caller)),
  createShift: execute((req, caller) => WorkService.createShift(req.body, caller), 201),
  updateShift: execute((req, caller) => WorkService.updateShift(req.params.id, req.body, caller)),
  deleteShift: execute((req, caller) => WorkService.deleteShift(req.params.id, caller)),
  assignShift: execute((req, caller) => WorkService.updateShift(req.params.id, { employeeId: req.body.employeeId }, caller)),
  swapShifts: execute((req, caller) => WorkService.swapShiftEmployees(req.body, caller)),
  listTemplates: execute((_req, caller) => WorkService.listTemplates(caller)),
  createTemplate: execute((req, caller) => WorkService.createTemplate(req.body, caller), 201),
  updateTemplate: execute((req, caller) => WorkService.updateTemplate(req.params.id, req.body, caller)),
  deleteTemplate: execute((req, caller) => WorkService.deleteTemplate(req.params.id, caller)),
  registerShift: execute((req, caller) => WorkService.registerShift(req.body, caller), 201),
  listRegistrations: execute((req, caller) => WorkService.listRegistrations(req.query, caller)),
  deleteRegistration: execute((req, caller) => WorkService.deleteRegistration(req.params.id, caller)),
  getConfig: execute((req, caller) => WorkService.getConfig(caller, req.query.branchId)),
  updateConfig: execute((req, caller) => WorkService.updateConfig(req.body, caller, req.query.branchId)),
  preflight: execute((req, caller) => WorkService.preflight(req.body, caller)),
  checkin: execute((req, caller) => WorkService.checkin(req.body, caller), 201),
  checkout: execute((req, caller) => WorkService.checkout(req.body, caller)),
  doubleAttendance: execute((req, caller) => WorkService.doubleAttendance(req.body, caller)),
  saveAttendance: execute((req, caller) => WorkService.saveAttendance(req.params.shiftId, req.body, caller)),
  listAttendance: execute((req, caller) => WorkService.listAttendance(req.query, caller)),
  listTasks: execute((req, caller) => WorkService.listTasks(req.query, caller)),
  createTask: execute((req, caller) => WorkService.createTask(req.body, caller), 201),
  updateTask: execute((req, caller) => WorkService.updateTask(req.params.id, req.body, caller)),
  deleteTask: execute((req, caller) => WorkService.deleteTask(req.params.id, caller)),
};
