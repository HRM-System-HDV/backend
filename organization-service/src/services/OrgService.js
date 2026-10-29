"use strict";

// OrgService (Flat 3-Tier Mẫu A): gộp Branch/Department/Employee Repository cũ,
// gọi trực tiếp Prisma + fallback in-memory. Luồng Route -> Controller -> Service -> Prisma.
const database = require("../config/database");
const { NotFoundError } = require("../utils/errors");
const { syncEmployeeToIdentity } = require("../clients/IdentityClient");

const seedEmployees = [
  { id: "NV-0001", name: "Trần Minh Tuấn", email: "admin@company.com", branchSlug: null, department: null, role: "Quản trị viên", systemRole: "admin", status: "đang làm", joinDate: "01-01-2024", baseSalary: 20000000, salaryType: "monthly" },
];
let memoryBranches = [];
let memoryDepartments = [];
let memoryEmployees = [...seedEmployees];

function sanitizeDepartmentManager(manager) {
  if (!manager || typeof manager !== "string") return "";
  return manager.split(/—|-|\(/)[0].trim();
}

// ============================================================
// Đồng bộ tham chiếu giữa 3 bảng trong cùng organization-service.
// Schema dùng tham chiếu chuỗi (employees.branchSlug / employees.department,
// branches.manager / departments.manager) theo quy ước của dự án, nên service
// phải tự giữ chúng đồng bộ thay vì dựa vào FK.
// ============================================================

function normalizeBranchSlug(slug) {
  return (slug || "").toString().trim().toUpperCase();
}

function normalizeKey(value) {
  return (value || "").toString().trim().toLowerCase();
}

async function findEmployeeByName(name) {
  const target = (name || "").trim();
  if (!target) return null;
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.employee.findFirst({ where: { name: target } });
    } catch (_) {
      return null;
    }
  }
  return memoryEmployees.find((e) => (e.name || "").trim() === target) || null;
}

// Gán nhân sự được chọn làm quản lý vào đúng chi nhánh.
async function assignBranchManager(branch) {
  if (!branch || !branch.manager) return null;
  const employee = await findEmployeeByName(branch.manager);
  if (!employee) return null;
  const branchSlug = normalizeBranchSlug(branch.slug);
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.employee.update({
        where: { id: employee.id },
        data: { branchSlug },
      });
    } catch (_) {
      return null;
    }
  }
  const mem = memoryEmployees.find((e) => e.id === employee.id);
  if (mem) mem.branchSlug = branchSlug;
  return mem || null;
}

// Gán nhân sự được chọn làm phụ trách vào đúng phòng ban.
async function assignDepartmentManager(department) {
  if (!department || !department.manager) return null;
  const employee = await findEmployeeByName(department.manager);
  if (!employee) return null;
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      return await prisma.employee.update({
        where: { id: employee.id },
        data: { department: department.name },
      });
    } catch (_) {
      return null;
    }
  }
  const mem = memoryEmployees.find((e) => e.id === employee.id);
  if (mem) mem.department = department.name;
  return mem || null;
}

// Đổi slug chi nhánh thì cập nhật toàn bộ hồ sơ nhân sự đang tham chiếu.
async function syncBranchSlugChange(oldSlug, newSlug) {
  const from = normalizeBranchSlug(oldSlug);
  const to = normalizeBranchSlug(newSlug);
  if (!from || !to || from === to) return;
  const prisma = database.getPrisma();
  if (prisma) {
    await prisma.employee
      .updateMany({
        where: { branchSlug: { equals: from, mode: "insensitive" } },
        data: { branchSlug: to },
      })
      .catch(() => {});
    return;
  }
  memoryEmployees.forEach((e) => {
    if (normalizeBranchSlug(e.branchSlug) === from) e.branchSlug = to;
  });
}

// Đổi tên phòng ban thì cập nhật toàn bộ hồ sơ nhân sự đang tham chiếu.
async function syncDepartmentNameChange(oldName, newName) {
  const from = (oldName || "").trim();
  const to = (newName || "").trim();
  if (!from || !to || normalizeKey(from) === normalizeKey(to)) return;
  const prisma = database.getPrisma();
  if (prisma) {
    await prisma.employee
      .updateMany({
        where: { department: { equals: from, mode: "insensitive" } },
        data: { department: to },
      })
      .catch(() => {});
    return;
  }
  memoryEmployees.forEach((e) => {
    if (normalizeKey(e.department) === normalizeKey(from)) e.department = to;
  });
}

async function clearBranchEmployees(slug) {
  const target = normalizeBranchSlug(slug);
  const prisma = database.getPrisma();
  if (prisma) {
    await prisma.employee
      .updateMany({
        where: { branchSlug: { equals: target, mode: "insensitive" } },
        data: { branchSlug: null },
      })
      .catch(() => {});
    return;
  }
  memoryEmployees.forEach((e) => {
    if (normalizeBranchSlug(e.branchSlug) === target) e.branchSlug = null;
  });
}

async function clearDepartmentEmployees(name) {
  const target = normalizeKey(name);
  const prisma = database.getPrisma();
  if (prisma) {
    await prisma.employee
      .updateMany({
        where: { department: { equals: name, mode: "insensitive" } },
        data: { department: null },
      })
      .catch(() => {});
    return;
  }
  memoryEmployees.forEach((e) => {
    if (normalizeKey(e.department) === target) e.department = null;
  });
}

// Tính lại cột thống kê staff cho tất cả chi nhánh/phòng ban.
async function refreshAllStaffCounts() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const [branches, departments, employees] = await Promise.all([
        prisma.branch.findMany({ select: { id: true, slug: true } }),
        prisma.department.findMany({ select: { id: true, name: true } }),
        prisma.employee.findMany({ select: { branchSlug: true, department: true } }),
      ]);
      const branchCounts = new Map();
      const departmentCounts = new Map();
      for (const e of employees) {
        const branchKey = normalizeBranchSlug(e.branchSlug);
        if (branchKey) branchCounts.set(branchKey, (branchCounts.get(branchKey) || 0) + 1);
        const deptKey = normalizeKey(e.department);
        if (deptKey) departmentCounts.set(deptKey, (departmentCounts.get(deptKey) || 0) + 1);
      }
      await Promise.all([
        ...branches.map((b) =>
          prisma.branch
            .update({
              where: { id: b.id },
              data: { staff: branchCounts.get(normalizeBranchSlug(b.slug)) || 0 },
            })
            .catch(() => {})
        ),
        ...departments.map((d) =>
          prisma.department
            .update({
              where: { id: d.id },
              data: { staff: departmentCounts.get(normalizeKey(d.name)) || 0 },
            })
            .catch(() => {})
        ),
      ]);
    } catch (_) {}
    return;
  }
  memoryBranches.forEach((b) => {
    b.staff = memoryEmployees.filter(
      (e) => normalizeBranchSlug(e.branchSlug) === normalizeBranchSlug(b.slug)
    ).length;
  });
  memoryDepartments.forEach((d) => {
    d.staff = memoryEmployees.filter(
      (e) => normalizeKey(e.department) === normalizeKey(d.name)
    ).length;
  });
}

// Đồng bộ dữ liệu cũ: quản lý đã ghi trên chi nhánh/phòng ban sẽ được gán
// vào hồ sơ nhân sự tương ứng (khớp theo họ tên).
async function syncOrgRelations() {
  const prisma = database.getPrisma();
  if (!prisma) return;
  try {
    const [branches, departments] = await Promise.all([
      prisma.branch.findMany({}),
      prisma.department.findMany({}),
    ]);
    for (const b of branches) {
      await assignBranchManager(b);
    }
    for (const d of departments) {
      await assignDepartmentManager(d);
    }
    await refreshAllStaffCounts();
  } catch (_) {}
}

// Mã chi nhánh (slug) do hệ thống tự sinh dạng CN-0001, client không được tự nhập.
function sanitizeBranchPayload(payload = {}) {
  const data = {};
  for (const key of ["name", "address", "status"]) {
    if (payload[key] !== undefined) data[key] = payload[key];
  }
  if (typeof data.slug === "string") data.slug = data.slug.trim();
  if (payload.manager !== undefined) {
    data.manager = sanitizeDepartmentManager(payload.manager);
  }
  return data;
}

function sanitizeDepartmentPayload(payload = {}) {
  const data = {};
  for (const key of ["name", "status"]) {
    if (payload[key] !== undefined) data[key] = payload[key];
  }
  // Mã phòng ban (code) do hệ thống tự sinh dạng PB-0001, client không được tự nhập.
  if (typeof data.code === "string") data.code = data.code.trim().toUpperCase();
  if (payload.manager !== undefined) {
    data.manager = sanitizeDepartmentManager(payload.manager);
  }
  return data;
}

async function ensureSeeded() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      // Không xoá dữ liệu thật khi khởi động. Chỉ đảm bảo tài khoản admin seed tồn tại.
      for (const e of seedEmployees) {
        const existed = await prisma.employee.findUnique({ where: { email: e.email } }).catch(() => null);
        if (!existed) await prisma.employee.create({ data: e }).catch(() => {});
      }
      const existingDepts = await prisma.department.findMany({}).catch(() => []);
      for (const d of existingDepts) {
        if (d.manager && (d.manager.includes("—") || d.manager.includes("-") || d.manager.includes("("))) {
          const clean = sanitizeDepartmentManager(d.manager);
          await prisma.department.update({ where: { id: d.id }, data: { manager: clean } }).catch(() => {});
        }
      }
      // Đồng bộ quản lý đã gán trên chi nhánh/phòng ban xuống hồ sơ nhân sự
      // và tính lại số lượng nhân sự cho dữ liệu đã có.
      await syncOrgRelations();
    } catch (_) {}
    return { mode: "postgres" };
  }
  return { mode: "memory" };
}

// --- Branches ---
async function listBranches() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const [rows, employees] = await Promise.all([
        prisma.branch.findMany({ orderBy: { slug: "asc" } }),
        prisma.employee.findMany({ select: { branchSlug: true } }),
      ]);
      const counts = new Map();
      for (const e of employees) {
        const key = normalizeBranchSlug(e.branchSlug);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      // Luôn trả số nhân sự thực tế, không phụ thuộc cột staff có thể cũ.
      return rows.map((b) => ({
        ...b,
        staff: counts.get(normalizeBranchSlug(b.slug)) || 0,
      }));
    } catch (_) {}
  }
  return memoryBranches.map((b) => ({
    ...b,
    staff: memoryEmployees.filter(
      (e) => normalizeBranchSlug(e.branchSlug) === normalizeBranchSlug(b.slug)
    ).length,
  }));
}

async function getBranch(slug) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.branch.findUnique({ where: { slug } });
      if (row) {
        const staff = await prisma.employee
          .count({
            where: { branchSlug: { equals: normalizeBranchSlug(row.slug), mode: "insensitive" } },
          })
          .catch(() => row.staff);
        return { ...row, staff };
      }
    } catch (_) {}
  } else {
    const row = memoryBranches.find((b) => b.slug === slug) || null;
    if (row) return row;
  }
  // Fallback memory khi Prisma lỗi nhưng memory rỗng
  const mem = memoryBranches.find((b) => b.slug === slug) || null;
  if (mem) return mem;
  // Thử lại Prisma lần cuối (trường hợp getPrisma null do lỗi transient)
  if (prisma) {
    try {
      return await prisma.branch.findUnique({ where: { slug } });
    } catch (_) {}
  }
  throw new NotFoundError("Không tìm thấy chi nhánh");
}

async function createBranch(payload) {
  const data = sanitizeBranchPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    let created;
    // Tạo tối đa 5 lần: trúng mã CN-xxxx trùng (đồng thời) -> sinh mã mới.
    for (let attempt = 0; attempt < 5; attempt++) {
      const branchSlug = await nextBranchSlug();
      try {
        created = await prisma.branch.create({ data: { ...data, slug: branchSlug } });
        break;
      } catch (e) {
        if (String(e.code) === "P2002" && String(e.meta?.target || "").includes("slug")) continue;
        if (String(e.code) === "P2002") {
          const err = new Error("Dữ liệu chi nhánh đã tồn tại");
          err.status = 409;
          err.code = "DUPLICATE_RESOURCE";
          throw err;
        }
        throw e;
      }
    }
    if (!created) {
      const err = new Error("Không thể sinh mã chi nhánh, vui lòng thử lại");
      err.status = 409;
      err.code = "DUPLICATE_RESOURCE";
      throw err;
    }
    // Gán nhân sự quản lý vào chi nhánh vừa tạo + tính lại số nhân sự.
    await assignBranchManager(created);
    await refreshAllStaffCounts();
    return (await prisma.branch.findUnique({ where: { slug: created.slug } })) || created;
  }
  if (memoryBranches.some((b) => b.slug === data.slug)) {
    const err = new Error("Dữ liệu chi nhánh đã tồn tại");
    err.status = 409;
    err.code = "DUPLICATE_RESOURCE";
    throw err;
  }
  const row = { id: `br-${Date.now()}`, slug: await nextBranchSlug(), staff: 0, status: "hoạt động", ...data };
  memoryBranches.push(row);
  await assignBranchManager(row);
  await refreshAllStaffCounts();
  return row;
}

async function updateBranch(slug, payload) {
  const data = sanitizeBranchPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    let updated;
    try {
      updated = await prisma.branch.update({ where: { slug }, data });
    } catch (e) {
      if (e && e.code === "P2025") return null;
      if (e && e.code === "P2002") {
        const err = new Error("Slug chi nhánh đã tồn tại");
        err.status = 409;
        err.code = "DUPLICATE_RESOURCE";
        throw err;
      }
      throw e;
    }
    // Đổi slug -> cập nhật hồ sơ nhân sự đang thuộc chi nhánh cũ.
    if (data.slug && data.slug !== slug) {
      await syncBranchSlugChange(slug, data.slug);
    }
    await assignBranchManager(updated);
    await refreshAllStaffCounts();
    return (await prisma.branch.findUnique({ where: { slug: updated.slug } })) || updated;
  }
  const idx = memoryBranches.findIndex((b) => b.slug === slug);
  if (idx < 0) return null;
  memoryBranches[idx] = { ...memoryBranches[idx], ...data };
  if (data.slug && data.slug !== slug) {
    await syncBranchSlugChange(slug, data.slug);
  }
  await assignBranchManager(memoryBranches[idx]);
  await refreshAllStaffCounts();
  return memoryBranches[idx];
}

async function removeBranch(slug) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.branch.delete({ where: { slug } });
    } catch (e) {
      if (e && e.code === "P2025") return false;
      throw e;
    }
    // Xoá chi nhánh -> bỏ tham chiếu chi nhánh trong hồ sơ nhân sự.
    await clearBranchEmployees(slug);
    await refreshAllStaffCounts();
    return true;
  }
  const idx = memoryBranches.findIndex((b) => b.slug === slug);
  if (idx < 0) return false;
  memoryBranches.splice(idx, 1);
  await clearBranchEmployees(slug);
  await refreshAllStaffCounts();
  return true;
}

// --- Departments ---
async function listDepartments() {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const [rows, employees] = await Promise.all([
        prisma.department.findMany({ orderBy: { code: "asc" } }),
        prisma.employee.findMany({ select: { department: true } }),
      ]);
      const counts = new Map();
      for (const e of employees) {
        const key = normalizeKey(e.department);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
      // Luôn trả số nhân sự thực tế theo tên phòng ban.
      return rows.map((d) => ({
        ...d,
        staff: counts.get(normalizeKey(d.name)) || 0,
      }));
    } catch (_) {}
  }
  return memoryDepartments.map((d) => ({
    ...d,
    staff: memoryEmployees.filter(
      (e) => normalizeKey(e.department) === normalizeKey(d.name)
    ).length,
  }));
}

async function getDepartment(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.department.findUnique({ where: { id } });
      if (row) {
        const staff = await prisma.employee
          .count({
            where: { department: { equals: row.name, mode: "insensitive" } },
          })
          .catch(() => row.staff);
        return { ...row, staff };
      }
    } catch (_) {}
  }
  const mem = memoryDepartments.find((d) => d.id === id) || null;
  if (mem) return mem;
  throw new NotFoundError("Không tìm thấy phòng ban");
}

async function createDepartment(payload) {
  const data = sanitizeDepartmentPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    let created;
    // Tạo tối đa 5 lần: trúng mã PB-xxxx trùng (đồng thời) -> sinh mã mới.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = await nextDepartmentCode();
      try {
        created = await prisma.department.create({ data: { ...data, code } });
        break;
      } catch (e) {
        if (String(e.code) === "P2002" && String(e.meta?.target || "").includes("code")) continue;
        if (String(e.code) === "P2002") {
          const err = new Error("Dữ liệu phòng ban đã tồn tại");
          err.status = 409;
          err.code = "DUPLICATE_RESOURCE";
          throw err;
        }
        throw e;
      }
    }
    if (!created) {
      const err = new Error("Không thể sinh mã phòng ban, vui lòng thử lại");
      err.status = 409;
      err.code = "DUPLICATE_RESOURCE";
      throw err;
    }
    // Gán nhân sự phụ trách vào phòng ban vừa tạo + tính lại số nhân sự.
    await assignDepartmentManager(created);
    await refreshAllStaffCounts();
    return (await prisma.department.findUnique({ where: { id: created.id } })) || created;
  }
  if (memoryDepartments.some((d) => d.code === data.code)) {
    const err = new Error("Dữ liệu phòng ban đã tồn tại");
    err.status = 409;
    err.code = "DUPLICATE_RESOURCE";
    throw err;
  }
  const row = { id: `dep-${Date.now()}`, code: await nextDepartmentCode(), staff: 0, status: "hoạt động", ...data };
  memoryDepartments.push(row);
  await assignDepartmentManager(row);
  await refreshAllStaffCounts();
  return row;
}

async function updateDepartment(id, payload) {
  const data = sanitizeDepartmentPayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    const existing = await prisma.department.findUnique({ where: { id } }).catch(() => null);
    if (!existing) return null;
    let updated;
    try {
      updated = await prisma.department.update({ where: { id }, data });
    } catch (e) {
      if (e && e.code === "P2025") return null;
      if (e && e.code === "P2002") {
        const err = new Error("Mã phòng ban đã tồn tại");
        err.status = 409;
        err.code = "DUPLICATE_RESOURCE";
        throw err;
      }
      throw e;
    }
    // Đổi tên phòng ban -> cập nhật hồ sơ nhân sự đang thuộc phòng ban cũ.
    if (data.name !== undefined) {
      await syncDepartmentNameChange(existing.name, data.name);
    }
    await assignDepartmentManager(updated);
    await refreshAllStaffCounts();
    return (await prisma.department.findUnique({ where: { id: updated.id } })) || updated;
  }
  const idx = memoryDepartments.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const previous = memoryDepartments[idx];
  memoryDepartments[idx] = { ...previous, ...data };
  if (data.name !== undefined) {
    await syncDepartmentNameChange(previous.name, data.name);
  }
  await assignDepartmentManager(memoryDepartments[idx]);
  await refreshAllStaffCounts();
  return memoryDepartments[idx];
}

async function removeDepartment(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    let removed;
    try {
      removed = await prisma.department.delete({ where: { id } });
    } catch (e) {
      if (e && e.code === "P2025") return false;
      throw e;
    }
    // Xoá phòng ban -> bỏ tham chiếu phòng ban trong hồ sơ nhân sự.
    await clearDepartmentEmployees(removed.name);
    await refreshAllStaffCounts();
    return true;
  }
  const idx = memoryDepartments.findIndex((d) => d.id === id);
  if (idx < 0) return false;
  const [removed] = memoryDepartments.splice(idx, 1);
  await clearDepartmentEmployees(removed.name);
  await refreshAllStaffCounts();
  return true;
}

// --- Employees ---
function applyEmployeeFilter(rows, query = {}) {
  let out = rows;
  if (query.branchSlug) {
    const target = normalizeBranchSlug(query.branchSlug);
    out = out.filter((e) => normalizeBranchSlug(e.branchSlug) === target);
  }
  if (query.departmentId || query.department) {
    const dep = normalizeKey(query.departmentId || query.department);
    out = out.filter((e) => normalizeKey(e.department) === dep);
  }
  if (query.systemRole) out = out.filter((e) => e.systemRole === query.systemRole);
  return out;
}

async function listEmployees(query = {}) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const where = {};
      if (query.branchSlug) {
        where.branchSlug = { equals: query.branchSlug, mode: "insensitive" };
      }
      if (query.systemRole) where.systemRole = query.systemRole;
      if (query.departmentId || query.department) {
        where.department = { equals: query.departmentId || query.department, mode: "insensitive" };
      }
      return await prisma.employee.findMany({ where, orderBy: { createdAt: "desc" } });
    } catch (_) {}
  }
  return applyEmployeeFilter(memoryEmployees, query);
}

async function getEmployee(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      const row = await prisma.employee.findUnique({ where: { id } });
      if (row) return row;
    } catch (_) {}
  }
  const mem = memoryEmployees.find((e) => e.id === id) || null;
  if (mem) return mem;
  const err = new NotFoundError("Không tìm thấy thông tin nhân sự trên hệ thống");
  err.code = "EMPLOYEE_NOT_FOUND";
  throw err;
}

// Whitelist field của model Employee trước khi ghi Prisma, tránh lỗi
// "Unknown argument" khi client gửi thêm field (vd: `branch` của frontend).
const EMPLOYEE_FIELDS = [
  "name", "email", "phone", "gender", "birthDate", "province", "ward", "street",
  "cccd", "issueDate", "issuePlace", "cccdFront", "cccdBack", "avatar", "branchSlug",
  "department", "role", "systemRole", "status", "joinDate", "baseSalary",
  "salaryType", "hourlySalary", "bankName", "bankAccountNumber", "bankAccountName",
];

function sanitizeEmployeePayload(payload = {}) {
  const data = {};
  const source = { ...payload };
  // Alias tương thích: frontend có thể gửi `branch` thay cho `branchSlug`.
  if (source.branchSlug === undefined && source.branch !== undefined) {
    source.branchSlug = source.branch;
  }
  for (const key of EMPLOYEE_FIELDS) {
    if (source[key] === undefined) continue;
    let value = source[key];

    // cccdFront/cccdBack/avatar là cột String (đường dẫn ảnh). Client cũ gửi boolean
    // trạng thái "đã chụp" — bỏ qua thay vì ghi sai kiểu làm Prisma throw.
    if (key === "cccdFront" || key === "cccdBack" || key === "avatar") {
      if (typeof value === "boolean") continue;
      data[key] = typeof value === "string" && value.trim() ? value.trim() : null;
      continue;
    }

    // Ép kiểu số cho cột Float, tránh NaN khi input để trống.
    if (key === "baseSalary" || key === "hourlySalary") {
      if (value === "" || value === null) {
        value = key === "hourlySalary" ? null : 0;
      } else {
        const num = Number(value);
        value = Number.isFinite(num) ? num : key === "hourlySalary" ? null : 0;
      }
      data[key] = value;
      continue;
    }

    // Chuỗi rỗng ở khóa ngoại/không bắt buộc lưu thành NULL cho sạch dữ liệu.
    if (typeof value === "string") value = value.trim();
    if (key === "branchSlug" && typeof value === "string") value = normalizeBranchSlug(value);
    if (["branchSlug", "department"].includes(key) && value === "") value = null;
    data[key] = value;
  }
  return data;
}

// Sinh mã theo chuỗi: quét các mã khớp "<prefix><4 số>" và trả về số lớn nhất + 1.
async function nextCode({ prisma, memoryRows, field, prefix, fallbackRows }) {
  let max = 0;
  const scan = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s.startsWith(prefix)) return;
    const n = Number(s.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  };
  const scanRows = (rows) => (Array.isArray(rows) ? rows.forEach((r) => scan(r[field])) : null);
  if (prisma) {
    const rows = await prisma[fallbackRows]
      .findMany({ where: { [field]: { startsWith: prefix } }, select: { [field]: true } })
      .catch(() => []);
    scanRows(rows);
  } else {
    scanRows(memoryRows);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// Sinh mã nhân viên gọn: NV-0001 (4 số, tăng dần theo mã lớn nhất hiện có).
async function nextEmployeeId() {
  return nextCode({
    prisma: database.getPrisma(),
    memoryRows: memoryEmployees,
    field: "id",
    prefix: "NV-",
    fallbackRows: "employee",
  });
}

// Sinh mã chi nhánh tự động: CN-0001 (dùng làm slug luôn).
async function nextBranchSlug() {
  return nextCode({
    prisma: database.getPrisma(),
    memoryRows: memoryBranches,
    field: "slug",
    prefix: "CN-",
    fallbackRows: "branch",
  });
}

// Sinh mã phòng ban tự động: PB-0001.
async function nextDepartmentCode() {
  return nextCode({
    prisma: database.getPrisma(),
    memoryRows: memoryDepartments,
    field: "code",
    prefix: "PB-",
    fallbackRows: "department",
  });
}

async function createEmployee(payload) {
  if (!["admin", "manager", "staff"].includes(payload.systemRole || "staff")) {
    const err = new Error("Vai trò hệ thống không hợp lệ");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const data = sanitizeEmployeePayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    let created;
    // Tạo tối đa 5 lần: nếu trúng id NV-xxxx trùng (đồng thời), tăng mã và thử lại.
    for (let attempt = 0; attempt < 5; attempt++) {
      const empId = await nextEmployeeId();
      try {
        created = await prisma.employee.create({ data: { ...data, id: empId } });
        break;
      } catch (e) {
        if (String(e.code) === "P2002") {
          const target = String(e.meta?.target || "");
          if (target.includes("id")) continue; // trùng mã -> sinh mã mới
          const err = new Error("Email đã tồn tại");
          err.status = 409;
          err.code = "DUPLICATE_RESOURCE";
          throw err;
        }
        throw e;
      }
    }
    // Nếu vòng lặp cạn (5 lần toàn trùng mã) coi như xung đột dữ liệu.
    if (!created) {
      const err = new Error("Không thể sinh mã nhân viên, vui lòng thử lại");
      err.status = 409;
      err.code = "DUPLICATE_RESOURCE";
      throw err;
    }
    await refreshAllStaffCounts();
    syncEmployeeToIdentity(created, "upsert").catch(() => {});
    return created;
  }
  if (memoryEmployees.some((e) => e.email === data.email)) {
    const err = new Error("Email đã tồn tại");
    err.status = 409;
    err.code = "DUPLICATE_RESOURCE";
    throw err;
  }
  const row = { id: await nextEmployeeId(), status: "đang làm", salaryType: "monthly", baseSalary: 0, ...data };
  memoryEmployees.push(row);
  await refreshAllStaffCounts();
  syncEmployeeToIdentity(row, "upsert").catch(() => {});
  return row;
}

async function updateEmployee(id, payload) {
  if (payload.systemRole && !["admin", "manager", "staff"].includes(payload.systemRole)) {
    const err = new Error("Vai trò hệ thống không hợp lệ");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const data = sanitizeEmployeePayload(payload);
  const prisma = database.getPrisma();
  if (prisma) {
    const existing = await prisma.employee.findUnique({ where: { id } }).catch(() => null);
    if (!existing) return null;
    let updated;
    try {
      updated = await prisma.employee.update({ where: { id }, data });
    } catch (e) {
      // P2025: không tìm thấy bản ghi -> controller trả 404 rõ ràng.
      if (e && e.code === "P2025") return null;
      if (e && e.code === "P2002") {
        const err = new Error("Email đã tồn tại");
        err.status = 409;
        err.code = "DUPLICATE_RESOURCE";
        throw err;
      }
      // Không nuốt lỗi DB rồi âm thầm ghi vào memory (gây cảm giác "đã lưu"
      // nhưng thực tế Postgres không đổi). Trả lỗi thật cho client.
      throw e;
    }
    // Đổi họ tên nhân sự -> cập nhật tên quản lý đang tham chiếu ở chi nhánh/phòng ban.
    if (data.name && data.name !== existing.name) {
      await prisma.branch
        .updateMany({ where: { manager: existing.name }, data: { manager: data.name } })
        .catch(() => {});
      await prisma.department
        .updateMany({ where: { manager: existing.name }, data: { manager: data.name } })
        .catch(() => {});
    }
    // Nhân sự đổi chi nhánh/phòng ban -> cập nhật lại số lượng nhân sự.
    await refreshAllStaffCounts();
    syncEmployeeToIdentity(updated, "upsert").catch(() => {});
    return updated;
  }
  const idx = memoryEmployees.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const previous = memoryEmployees[idx];
  memoryEmployees[idx] = { ...previous, ...data };
  if (data.name && data.name !== previous.name) {
    memoryBranches.forEach((b) => {
      if (b.manager === previous.name) b.manager = data.name;
    });
    memoryDepartments.forEach((d) => {
      if (d.manager === previous.name) d.manager = data.name;
    });
  }
  await refreshAllStaffCounts();
  syncEmployeeToIdentity(memoryEmployees[idx], "upsert").catch(() => {});
  return memoryEmployees[idx];
}

async function removeEmployee(id) {
  const prisma = database.getPrisma();
  if (prisma) {
    try {
      await prisma.employee.delete({ where: { id } });
    } catch (e) {
      if (e && e.code === "P2025") return false;
      throw e;
    }
    await refreshAllStaffCounts();
    syncEmployeeToIdentity({ id }, "delete").catch(() => {});
    return true;
  }
  const idx = memoryEmployees.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  memoryEmployees.splice(idx, 1);
  await refreshAllStaffCounts();
  syncEmployeeToIdentity({ id }, "delete").catch(() => {});
  return true;
}

module.exports = {
  ensureSeeded,
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
  removeBranch,
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  removeDepartment,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  removeEmployee,
};
