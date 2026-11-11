"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateEmployee } = require("../../src/validators/orgValidator");
const {
  assertCanWriteEmployee,
  assertCanCreateEmployee,
  assertCanDeleteEmployee,
} = require("../../src/utils/employeeAccess");

test("validateEmployee systemRole", () => {
  assert.deepEqual(validateEmployee({ name: "A", email: "a@company.com", systemRole: "staff" }), []);
  assert.ok(validateEmployee({ name: "A", email: "a@company.com", systemRole: "boss" }).length > 0);
});

// Bug 1: manager không được set field đặc quyền qua payload sửa hồ sơ thường.
test("assertCanWriteEmployee: manager bị lọc field đặc quyền (systemRole/branchSlug/email/baseSalary)", () => {
  const target = { id: "NV-0010", email: "nv@company.com", branchSlug: "CN-0001", systemRole: "staff" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  const payload = { name: "Đổi tên", phone: "0900", systemRole: "admin", branchSlug: "CN-0009", email: "hack@x.com", baseSalary: 99999999 };
  const out = assertCanWriteEmployee(target, manager, payload);
  assert.equal(out.name, "Đổi tên");
  assert.equal(out.phone, "0900");
  assert.ok(!("systemRole" in out));
  assert.ok(!("branchSlug" in out));
  assert.ok(!("email" in out));
  assert.ok(!("baseSalary" in out));
});

test("assertCanWriteEmployee: manager tự nâng quyền trên hồ sơ của mình cũng bị lọc", () => {
  const self = { id: "NV-0002", email: "mgr@company.com", branchSlug: "CN-0001", systemRole: "manager" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  const out = assertCanWriteEmployee(self, manager, { systemRole: "admin", baseSalary: 100000000 });
  assert.deepEqual(out, {});
});

test("assertCanWriteEmployee: manager sửa hồ sơ ngoài chi nhánh -> 403", () => {
  const other = { id: "NV-0055", email: "k@company.com", branchSlug: "CN-0002", systemRole: "staff" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  assert.throws(() => assertCanWriteEmployee(other, manager, { name: "X" }), (e) => e.status === 403);
});

test("assertCanWriteEmployee: admin giữ nguyên payload (vẫn đổi được lương/vai trò)", () => {
  const target = { id: "NV-0010", branchSlug: "CN-0001", systemRole: "staff" };
  const admin = { userId: "NV-0001", role: "admin", branchSlug: null };
  const payload = { baseSalary: 25000000, systemRole: "manager" };
  assert.deepEqual(assertCanWriteEmployee(target, admin, payload), payload);
});

// Bug 3: staff tự sửa hồ sơ mình bằng field thường -> pass; còn lại -> 403.
test("assertCanWriteEmployee: staff tự sửa field thường -> chỉ trả về field đó", () => {
  const self = { id: "NV-0009", email: "staff@company.com", branchSlug: "CN-0001", systemRole: "staff" };
  const staff = { userId: "NV-0009", role: "staff", branchSlug: "CN-0001" };
  assert.deepEqual(assertCanWriteEmployee(self, staff, { phone: "0900", name: "A" }), { phone: "0900", name: "A" });
});

test("assertCanWriteEmployee: staff sửa hồ sơ người khác -> 403", () => {
  const other = { id: "NV-0011", email: "b@company.com", branchSlug: "CN-0001", systemRole: "staff" };
  const staff = { userId: "NV-0009", role: "staff", branchSlug: "CN-0001" };
  assert.throws(() => assertCanWriteEmployee(other, staff, { phone: "0900" }), (e) => e.status === 403);
});

test("assertCanWriteEmployee: staff tự sửa field đặc quyền (email/systemRole) -> 403", () => {
  const self = { id: "NV-0009", email: "staff@company.com", branchSlug: "CN-0001", systemRole: "staff" };
  const staff = { userId: "NV-0009", role: "staff", branchSlug: "CN-0001" };
  assert.throws(() => assertCanWriteEmployee(self, staff, { systemRole: "admin" }), (e) => e.status === 403);
});

// Bug 2: quyền xóa phải chặn admin + scope chi nhánh.
test("assertCanDeleteEmployee: manager không được xóa admin -> 403", () => {
  const admin = { id: "NV-0001", email: "admin@company.com", branchSlug: "CN-0001", systemRole: "admin" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  assert.throws(() => assertCanDeleteEmployee(admin, manager), (e) => e.status === 403);
});

test("assertCanDeleteEmployee: manager không được xóa người ngoài chi nhánh -> 403", () => {
  const other = { id: "NV-0077", branchSlug: "CN-0002", systemRole: "staff" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  assert.throws(() => assertCanDeleteEmployee(other, manager), (e) => e.status === 403);
});

test("assertCanDeleteEmployee: manager xóa người cùng chi nhánh (không phải admin) -> pass", () => {
  const same = { id: "NV-0088", branchSlug: "CN-0001", systemRole: "staff" };
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  assert.doesNotThrow(() => assertCanDeleteEmployee(same, manager));
});

test("assertCanDeleteEmployee: staff không được xóa admin -> 403; admin xóa ai cũng pass", () => {
  const admin = { id: "NV-0001", branchSlug: null, systemRole: "admin" };
  const staff = { userId: "NV-0009", role: "staff", branchSlug: "CN-0001" };
  const adminCaller = { userId: "NV-0001", role: "admin", branchSlug: null };
  assert.throws(() => assertCanDeleteEmployee(admin, staff), (e) => e.status === 403);
  assert.doesNotThrow(() => assertCanDeleteEmployee(admin, adminCaller));
});

// Bug 4: đường TẠO hồ sơ cũng là đường leo quyền, gateway chỉ chặn theo vai trò.
test("assertCanCreateEmployee: manager không tạo được admin/manager -> 403", () => {
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  for (const systemRole of ["admin", "manager"]) {
    assert.throws(
      () => assertCanCreateEmployee(manager, { name: "A", email: "a@x.com", systemRole }),
      (e) => e.status === 403,
      `manager không được tạo systemRole=${systemRole}`
    );
  }
});

test("assertCanCreateEmployee: manager bị ghim chi nhánh, bản tạo mới luôn là staff", () => {
  const manager = { userId: "NV-0002", role: "manager", branchSlug: "CN-0001" };
  const out = assertCanCreateEmployee(manager, { name: "A", email: "a@x.com", branchSlug: "CN-0009" });
  assert.equal(out.branchSlug, "CN-0001");
  assert.equal(out.systemRole, "staff");
});

test("assertCanCreateEmployee: staff bị chặn, admin giữ nguyên payload", () => {
  const staff = { userId: "NV-0009", role: "staff", branchSlug: "CN-0001" };
  assert.throws(() => assertCanCreateEmployee(staff, { name: "A" }), (e) => e.status === 403);
  const admin = { userId: "NV-0001", role: "admin", branchSlug: null };
  const payload = { name: "A", email: "a@x.com", systemRole: "manager", branchSlug: "CN-0009", baseSalary: 5000000 };
  assert.deepEqual(assertCanCreateEmployee(admin, payload), payload);
});

test("assertCanCreateEmployee: manager chưa được gán chi nhánh -> 403, không dựng hồ sơ trôi nổi", () => {
  assert.throws(
    () => assertCanCreateEmployee({ userId: "NV-0002", role: "manager", branchSlug: null }, { name: "A" }),
    (e) => e.status === 403
  );
});

