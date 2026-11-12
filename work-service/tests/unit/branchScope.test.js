"use strict";

// Khóa hành vi phân quyền theo chi nhánh và theo chủ sở hữu của work-service:
// - quản lý chỉ thao tác được bản ghi thuộc chi nhánh của mình
// - không ai chấm công được vào ca của người khác
// - nhân viên thấy được nhiệm vụ theo ca của chi nhánh mình

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  scopeTaskQuery,
  scopeBranchQuery,
  assertBranchScope,
  assertSelfEmployee,
} = require("../../src/utils/caller");
const WorkService = require("../../src/services/WorkService");

const ADMIN = { userId: "u-admin", role: "admin", branchSlug: null };
const MANAGER_A = { userId: "u-mgr-a", role: "manager", branchSlug: "CN-A" };
const MANAGER_B = { userId: "u-mgr-b", role: "manager", branchSlug: "CN-B" };
const STAFF = { userId: "u-staff", role: "staff", branchSlug: "CN-A" };

test("quản lý chỉ được thao tác bản ghi thuộc chi nhánh của mình", () => {
  // Không ném: cùng chi nhánh.
  assert.doesNotThrow(() =>
    assertBranchScope({ branchSlug: "CN-A" }, MANAGER_A, "ngoài chi nhánh"),
  );
  // Không ném: admin không giới hạn.
  assert.doesNotThrow(() =>
    assertBranchScope({ branchSlug: "CN-B" }, ADMIN, "ngoài chi nhánh"),
  );
  // Ném: khác chi nhánh.
  assert.throws(
    () => assertBranchScope({ branchSlug: "CN-B" }, MANAGER_A, "ngoài chi nhánh"),
    /ngoài chi nhánh/,
  );
  // Ném: quản lý chưa được gán chi nhánh thì không thao tác được bản ghi nào.
  assert.throws(
    () => assertBranchScope({ branchSlug: "CN-B" }, { role: "manager", branchSlug: null }, "ngoài chi nhánh"),
    /ngoài chi nhánh/,
  );
  // Không ném: nhân viên (đã bị ghim theo employeeId ở assertSelfEmployee).
  assert.doesNotThrow(() =>
    assertBranchScope({ branchSlug: "CN-B" }, STAFF, "ngoài chi nhánh"),
  );
});

test("chấm công không được ghi vào ca của nhân viên khác", async () => {
  const shift = await WorkService.createShift({
    employeeId: "u-emp-owner",
    branchSlug: "CN-A",
    date: "12/11/2026",
    template: "Ca Sáng",
    scheduledStart: "07:00",
    scheduledEnd: "14:00",
  });

  await assert.rejects(
    () => WorkService.checkin({ employeeId: "u-emp-other", shiftId: shift.id, checkinTime: "07:05" }),
    /không thuộc nhân viên này/i,
  );

  // Chủ ca thì chấm công được.
  const row = await WorkService.checkin({
    employeeId: "u-emp-owner",
    shiftId: shift.id,
    checkinTime: "07:05",
  });
  assert.equal(row.checkIn, "07:05");
});

test("nhân viên không được chấm công hộ người khác", () => {
  // Không gửi employeeId thì bị ghim về chính mình.
  const forced = assertSelfEmployee({ shiftId: "CA-1" }, STAFF);
  assert.equal(forced.employeeId, STAFF.userId);
  // Gửi employeeId của người khác thì bị chặn.
  assert.throws(
    () => assertSelfEmployee({ employeeId: "u-emp-other" }, STAFF),
    /thay người khác/,
  );
});

test("scopeTaskQuery: nhân viên thấy nhiệm vụ của mình + nhiệm vụ theo ca chi nhánh mình", () => {
  const q = scopeTaskQuery({ status: "pending" }, STAFF);
  assert.equal(q.assignedTo, STAFF.userId);
  assert.equal(q.includeShiftTasksOfBranch, "CN-A");
  assert.equal(q.status, "pending");

  // Quản lý/admin không bị ghim: xem theo query gửi lên.
  assert.deepEqual(scopeTaskQuery({}, MANAGER_A), {});
  assert.deepEqual(scopeTaskQuery({}, ADMIN), {});
});

test("scopeBranchQuery: quản lý bị ghim chi nhánh, admin thì không", () => {
  assert.equal(scopeBranchQuery({}, MANAGER_A).branchSlug, "CN-A");
  assert.deepEqual(scopeBranchQuery({}, ADMIN), {});
});
