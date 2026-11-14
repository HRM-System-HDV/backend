"use strict";
const OrgService = require("../services/OrgService");
const { callerFrom } = require("../utils/employeeAccess");
const handlers = {};
handlers.listDepartmentManagerCandidates = async (req, res, next) => {
  try { res.json({ data: await OrgService.listDepartmentManagerCandidates(req.params.id, callerFrom(req)) }); }
  catch (error) { next(error); }
};
handlers.listBranchManagerCandidates = async (req, res, next) => {
  try { res.json({ data: await OrgService.listBranchManagerCandidates(req.params.id, callerFrom(req)) }); }
  catch (error) { next(error); }
};
for (const [title,plural] of [["Branch","Branches"],["Department","Departments"],["Position","Positions"],["Employee","Employees"]]) {
  handlers[`list${plural}`] = async (req,res,next) => { try { res.json({data:await OrgService[`list${plural}`](req.query,callerFrom(req)),message:"Thao tác thành công"}); } catch(error) {next(error);} };
  handlers[`get${title}`] = async (req,res,next) => { try {res.json({data:await OrgService[`get${title}`](req.params.id,callerFrom(req)),message:"Thao tác thành công"});} catch(error) {next(error);} };
  handlers[`create${title}`] = async (req,res,next) => { try {res.status(201).json({data:await OrgService[`create${title}`](req.body,callerFrom(req)),message:"Thao tác thành công"});} catch(error) {next(error);} };
  handlers[`update${title}`] = async (req,res,next) => { try {res.json({data:await OrgService[`update${title}`](req.params.id,req.body,callerFrom(req)),message:"Thao tác thành công"});} catch(error) {next(error);} };
  if (title !== "Employee") handlers[`delete${title}`] = async (req,res,next) => { try {res.json({data:await OrgService[`remove${title}`](req.params.id,callerFrom(req)),message:title === "Employee" ? "Đã ghi nhận nhân viên nghỉ việc" : "Thao tác thành công"});} catch(error) {next(error);} };
}
handlers.leaveEmployee = async (req,res,next) => { try {res.json({data:await OrgService.removeEmployee(req.params.id,callerFrom(req),req.body?.resignedAt),message:"Đã ghi nhận nhân viên nghỉ việc"});} catch(error) {next(error);} };
module.exports = handlers;
