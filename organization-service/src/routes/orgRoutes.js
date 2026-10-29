"use strict";

const express = require("express");
const OrgController = require("../controllers/OrgController");

const router = express.Router();

router.get("/branches", OrgController.listBranches);
router.get("/branches/:slug", OrgController.getBranch);
router.post("/branches", OrgController.createBranch);
router.put("/branches/:slug", OrgController.updateBranch);
router.delete("/branches/:slug", OrgController.deleteBranch);

router.get("/departments", OrgController.listDepartments);
router.get("/departments/:id", OrgController.getDepartment);
router.post("/departments", OrgController.createDepartment);
router.put("/departments/:id", OrgController.updateDepartment);
router.delete("/departments/:id", OrgController.deleteDepartment);

router.get("/employees", OrgController.listEmployees);
router.get("/employees/:id", OrgController.getEmployee);
router.post("/employees", OrgController.createEmployee);
router.put("/employees/:id", OrgController.updateEmployee);
router.post("/employees/:id/leave", OrgController.leaveEmployee);
router.delete("/employees/:id", OrgController.deleteEmployee);

module.exports = router;
