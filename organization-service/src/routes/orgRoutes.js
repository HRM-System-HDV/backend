"use strict";
const router = require("express").Router();
const controller = require("../controllers/OrgController");
router.get("/branches/:id/manager-candidates", controller.listBranchManagerCandidates);
router.get("/departments/:id/manager-candidates", controller.listDepartmentManagerCandidates);
for (const [path,title,plural] of [["branches","Branch","Branches"],["departments","Department","Departments"],["positions","Position","Positions"],["employees","Employee","Employees"]]) {
  router.get(`/${path}`,controller[`list${plural}`]);
  router.get(`/${path}/:id`,controller[`get${title}`]);
  router.post(`/${path}`,controller[`create${title}`]);
  router.put(`/${path}/:id`,controller[`update${title}`]);
  router.delete(`/${path}/:id`,controller[`delete${title}`]);
}
router.post("/employees/:id/leave",controller.leaveEmployee);
module.exports = router;
