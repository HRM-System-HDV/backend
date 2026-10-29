"use strict";

const PayrollService = require("../services/PayrollService");
const { createPayoutUseCase, generatePayslipUseCase } = PayrollService;
const { validatePayout, validateGenerate } = require("../validators/payrollValidator");
const { ValidationError, NotFoundError } = require("../utils/errors");

async function listBankAccounts(_req, res, next) {
  try {
    const rows = await PayrollService.listBankAccounts();
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updateBankAccount(req, res, next) {
  try {
    const row = await PayrollService.updateBankAccount(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy tài khoản ngân hàng");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listPayouts(_req, res, next) {
  try {
    const rows = await PayrollService.listPayouts();
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createPayout(req, res, next) {
  try {
    const errors = validatePayout(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await createPayoutUseCase(req.body);
    const status = row.deduped ? 200 : 201;
    return res.status(status).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function createBankAccount(req, res, next) {
  try {
    if (!req.body.accountNumber) throw new ValidationError("Thiếu accountNumber");
    const row = await PayrollService.createBankAccount(req.body);
    return res.status(201).json({ data: row, message: "Tạo tài khoản thành công" });
  } catch (e) {
    return next(e);
  }
}

async function deleteBankAccount(req, res, next) {
  try {
    const ok = await PayrollService.deleteBankAccount(req.params.id);
    if (!ok) throw new NotFoundError("Không tìm thấy tài khoản ngân hàng");
    return res.status(200).json({ data: { ok: true }, message: "Xóa tài khoản thành công" });
  } catch (e) {
    return next(e);
  }
}

async function getPayslip(req, res, next) {
  try {
    const row = await PayrollService.getPayslip(req.params.id);
    if (!row) throw new NotFoundError("Không tìm thấy phiếu lương");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function listPayslips(req, res, next) {
  try {
    const rows = await PayrollService.listPayslips(req.query);
    return res.status(200).json({ data: rows, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function generatePayslip(req, res, next) {
  try {
    const errors = validateGenerate(req.body);
    if (errors.length) throw new ValidationError(errors.join("; "));
    const row = await generatePayslipUseCase(req.body);
    return res.status(201).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function updatePayslip(req, res, next) {
  try {
    const row = await PayrollService.updatePayslip(req.params.id, req.body);
    if (!row) throw new NotFoundError("Không tìm thấy phiếu lương");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

async function setPayslipStatus(req, res, next) {
  try {
    if (!req.body.status) throw new ValidationError("Thiếu trạng thái phiếu");
    const row = await PayrollService.setPayslipStatus(req.params.id, req.body.status);
    if (!row) throw new NotFoundError("Không tìm thấy phiếu lương");
    return res.status(200).json({ data: row, message: "Thao tác thành công" });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  listBankAccounts,
  updateBankAccount,
  createBankAccount,
  deleteBankAccount,
  listPayouts,
  createPayout,
  listPayslips,
  generatePayslip,
  updatePayslip,
  setPayslipStatus,
  getPayslip,
};
