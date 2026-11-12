"use strict";
const service = require("../services/PayrollService");
const { callerFrom } = require("../utils/caller");
const action = (fn, status = 200) => async (req, res, next) => { try { const data = await fn(req, callerFrom(req)); res.status(data?.deduped ? 200 : status).json({ data, message: "Thao tác thành công" }); } catch (error) { next(error); } };
module.exports = {
  listBankAccounts: action((_req, actor) => service.listBankAccounts(actor)),
  createBankAccount: action((req, actor) => service.createBankAccount(req.body, actor), 201),
  updateBankAccount: action((req, actor) => service.updateBankAccount(req.params.id, req.body, actor)),
  deleteBankAccount: action((req, actor) => service.deleteBankAccount(req.params.id, actor)),
  listPayouts: action((_req, actor) => service.listPayouts(actor)),
  createPayout: action((req, actor) => service.createPayoutUseCase(req.body, actor), 201),
  listPayslips: action((req, actor) => service.listPayslips(req.query, actor)),
  getPayslip: action((req, actor) => service.getPayslip(req.params.id, actor)),
  generatePayslip: action((req, actor) => service.generatePayslipUseCase(req.body, actor), 201),
  updatePayslip: action((req, actor) => service.updatePayslip(req.params.id, req.body, actor)),
  confirmPayslip: action((req, actor) => service.confirmPayslip(req.params.id, actor)),
  setPayslipStatus: action((req, actor) => service.setPayslipStatus(req.params.id, req.body.status, actor)),
};