"use strict";

const express = require("express");
const PayrollController = require("../controllers/PayrollController");

const router = express.Router();

router.get("/payroll/bank-accounts", PayrollController.listBankAccounts);
router.post("/payroll/bank-accounts", PayrollController.createBankAccount);
router.put("/payroll/bank-accounts/:id", PayrollController.updateBankAccount);
router.delete("/payroll/bank-accounts/:id", PayrollController.deleteBankAccount);

router.get("/payroll/payouts", PayrollController.listPayouts);
router.post("/payroll/payouts", PayrollController.createPayout);

router.get("/payroll/payslips", PayrollController.listPayslips);
router.post("/payroll/payslips/generate", PayrollController.generatePayslip);
router.put("/payroll/payslips/:id/status", PayrollController.setPayslipStatus);
router.put("/payroll/payslips/:id", PayrollController.updatePayslip);
router.get("/payroll/payslips/:id", PayrollController.getPayslip);

module.exports = router;
