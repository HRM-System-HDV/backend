"use strict";

// Khóa hành vi ghim chi nhánh khi đọc phiếu lương: quản lý chỉ thấy phiếu
// của chi nhánh mình, nhân viên chỉ thấy phiếu của mình, admin không giới hạn.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { scopePayslipQuery, assertOwnPayslip } = require("../../src/utils/caller");

const ADMIN = { userId: "u-admin", role: "admin", branchSlug: null };
const MANAGER = { userId: "u-mgr", role: "manager", branchSlug: "CN-A" };
const MANAGER_NO_BRANCH = { userId: "u-mgr-2", role: "manager", branchSlug: null };
const STAFF = { userId: "u-staff", role: "staff", branchSlug: "CN-A" };

test("quản lý được ghim chi nhánh khi đọc phiếu lương", () => {
  const q = scopePayslipQuery({ month: "11-2026" }, MANAGER);
  assert.equal(q.branchSlug, "CN-A");
  assert.equal(q.month, "11-2026");
  // Client không được tự chọn chi nhánh khác.
  const forced = scopePayslipQuery({ branchSlug: "CN-B" }, MANAGER);
  assert.equal(forced.branchSlug, "CN-A");
});

test("quản lý chưa gán chi nhánh thì không được đọc phiếu lương", () => {
  assert.throws(() => scopePayslipQuery({}, MANAGER_NO_BRANCH), /chi nhánh/);
});

test("nhân viên chỉ đọc được phiếu của chính mình", () => {
  const q = scopePayslipQuery({ employeeId: "u-other" }, STAFF);
  assert.equal(q.employeeId, STAFF.userId);
});

test("admin không bị giới hạn", () => {
  assert.deepEqual(scopePayslipQuery({ month: "11-2026" }, ADMIN), { month: "11-2026" });
});

test("assertOwnPayslip theo chi nhánh cho quản lý", () => {
  // Cùng chi nhánh: được xem.
  assert.doesNotThrow(() =>
    assertOwnPayslip({ employeeId: "u-staff", branchSlug: "CN-A" }, MANAGER),
  );
  // Khác chi nhánh: bị chặn.
  assert.throws(
    () => assertOwnPayslip({ employeeId: "u-staff", branchSlug: "CN-B" }, MANAGER),
    /chi nhánh/,
  );
  // Nhân viên xem phiếu người khác: bị chặn.
  assert.throws(
    () => assertOwnPayslip({ employeeId: "u-other", branchSlug: "CN-A" }, STAFF),
    /người khác/,
  );
});
