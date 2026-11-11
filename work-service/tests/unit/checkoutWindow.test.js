"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const database = require("../../src/config/database");
const WorkService = require("../../src/services/WorkService");
const WorkController = require("../../src/controllers/WorkController");
const IntegrationClient = require("../../src/clients/IntegrationClient");
const { toVnDate } = require("../../src/utils/dateFormat");

// Unit test chạy với prisma giả: không được chạm Postgres shared của môi trường dev.
function withFakePrisma(stub, fn) {
  const original = database.getPrisma;
  database.getPrisma = () => stub;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      database.getPrisma = original;
    });
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const now = new Date();
const checkedInAt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
// Ca kết thúc 2 tiếng trước: hạn chốt ra ( + cửa sổ 60 phút) đã qua chắc chắn.
const endedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
const day = toVnDate(endedAt);

function shiftRow(overrides = {}) {
  return {
    id: "CA-1",
    employeeId: "u-emp-1",
    branchSlug: "cn-a",
    date: day,
    scheduledStart: hhmm(checkedInAt),
    scheduledEnd: hhmm(endedAt),
    checkIn: hhmm(checkedInAt),
    checkOut: null,
    status: "đang làm",
    ...overrides,
  };
}

function attendanceRow(overrides = {}) {
  return {
    id: "att-1",
    employeeId: "u-emp-1",
    shiftId: "CA-1",
    date: day,
    checkIn: hhmm(checkedInAt),
    checkOut: null,
    penaltyAmount: 20000,
    penaltyNote: "Đi muộn 25 phút so với ca 08:00",
    status: "late",
    ...overrides,
  };
}

function makeDb({ window = 60, shift = null, attendances = [] } = {}) {
  const state = { shift, attendances, created: 0, updated: 0 };
  const stub = {
    attendanceConfig: {
      findUnique: async () => ({
        id: "default",
        latePenaltyAmount: 20000,
        earlyLeavePenaltyAmount: 15000,
        gracePeriodMinutes: 5,
        checkoutWindowMinutes: window,
      }),
      create: async ({ data }) => data,
    },
    shift: {
      findUnique: async ({ where }) => (state.shift && state.shift.id === where.id ? state.shift : null),
      findMany: async () => (state.shift ? [state.shift] : []),
      update: async ({ where, data }) => {
        state.shift = { ...state.shift, ...data, id: where.id };
        return state.shift;
      },
    },
    attendance: {
      findMany: async ({ where = {} }) =>
        state.attendances.filter((a) => (!where.employeeId || a.employeeId === where.employeeId) && (!where.shiftId || a.shiftId === where.shiftId)),
      create: async ({ data }) => {
        state.created += 1;
        const row = { id: `att-new-${state.created}`, ...data };
        state.attendances.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        state.updated += 1;
        const idx = state.attendances.findIndex((a) => a.id === where.id);
        state.attendances[idx] = { ...state.attendances[idx], ...data };
        return state.attendances[idx];
      },
    },
  };
  return { stub, state };
}

function captureRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

function callerHeaders(caller) {
  return { "x-user-id": caller.userId, "x-user-role": caller.role, "x-branch-slug": caller.branchSlug };
}

async function callCheckout(caller, body) {
  const req = { headers: callerHeaders(caller), body, params: {}, query: {} };
  const res = captureRes();
  let thrown = null;
  await WorkController.checkout(req, res, (e) => {
    thrown = e;
  });
  return { res, thrown };
}

// Unit test không được gọi thật xuống integration-service (4005) đang chạy trong dev.
// fail = true để mô phỏng integration-service lỗi.
function withFakeNotification(fn, { fail = false } = {}) {
  const original = IntegrationClient.createBranchNotification;
  const sent = [];
  IntegrationClient.createBranchNotification = async (payload) => {
    if (fail) throw new Error("integration-service không phản hồi");
    sent.push(payload);
    return { ok: true, status: 201 };
  };
  return Promise.resolve()
    .then(() => fn(sent))
    .finally(() => {
      IntegrationClient.createBranchNotification = original;
    });
}

test("quên chốt ra quá cửa sổ: đọc attendance/shift phải lộ missed và không lộ checkOut", async () => {
  const { stub } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      const rows = await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "missed");
      assert.equal(rows[0].checkOut, null, "bản ghi missed không được lộ checkOut để client tính giờ công");
      assert.equal(rows[0].penaltyAmount, 20000, "phạt đi muộn giữ nguyên");

      const single = await WorkService.getShiftById("CA-1");
      assert.equal(single.status, "missed");
      const listed = await WorkService.listShifts({ employeeId: "u-emp-1" });
      assert.equal(listed[0].status, "missed");

      // Nhân viên không tự chốt muộn để "cứu" ca được; phải nhờ quản lý/admin.
      await assert.rejects(
        () => WorkService.checkout({ employeeId: "u-emp-1", shiftId: "CA-1", checkoutTime: hhmm(now) }),
        /bạn hãy liên hệ quản lý hoặc admin/
      );
      const after = await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(after[0].checkOut, null, "chốt ra bị từ chối thì bản ghi vẫn mở");
      assert.equal(sent.length, 1, "đúng một thông báo cho lần chuyển sang missed");
    });
  });
});

test("checkoutWindowMinutes = 0: không tự bỏ qua ca, nhân viên vẫn chốt ra bình thường", async () => {
  const { stub, state } = makeDb({ window: 0, shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      const rows = await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(rows[0].status, "late", "0 là tắt tính năng nên không được đổi thành missed");
      assert.equal((await WorkService.getShiftById("CA-1")).status, "đang làm");
      assert.equal(sent.length, 0, "tắt tính năng thì không được báo");

      const row = await WorkService.checkout({ employeeId: "u-emp-1", shiftId: "CA-1", checkoutTime: hhmm(now) });
      assert.equal(row.checkOut, hhmm(now));
      assert.notEqual(row.status, "missed");
      assert.equal(state.created, 0);
    });
  });
});

test("chuyển sang missed: lưu status missed và thông báo đúng một lần cho chi nhánh", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      const rows = await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(rows[0].status, "missed");
      assert.equal(state.attendances[0].status, "missed", "phải ghi status xuống bản ghi chấm công");
      assert.equal(sent.length, 1, "lần đầu chuyển sang missed: một thông báo");

      const payload = sent[0];
      assert.equal(payload.branchSlug, "cn-a", "thông báo phạm vi chi nhánh của ca");
      assert.equal(payload.targetEmployeeId, null, "null + branchSlug để manager chi nhánh và admin cùng thấy");
      assert.match(payload.title, /u-emp-1/);
      assert.match(payload.body, /chưa chốt ra/);
      assert.match(payload.body, /ngày \d{2}\/\d{2}\/\d{4}/);

      // Đọc lại không được báo trùng lần hai.
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(sent.length, 1, "bản ghi đã lưu missed thì đọc lại không báo nữa");
      assert.equal(state.updated, 1, "chỉ ghi đúng một lần");
    });
  });
});

test("admin chốt ra hộ ca đã bị bỏ qua: 200 qua POST /api/attendance/checkout", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.equal(state.attendances[0].status, "missed");

      const { res, thrown } = await callCheckout(
        { userId: "u-admin-1", role: "admin", branchSlug: null },
        { employeeId: "u-emp-1", shiftId: "CA-1", time: "19:00" }
      );
      assert.equal(thrown, null, `admin phải chốt hộ được, nhận ${JSON.stringify(res.body)}`);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.checkOut, "19:00", "checkOut được ghi -> ca được ghi công trở lại");
      assert.notEqual(res.body.data.status, "missed");
      assert.equal(res.body.data.status, "late", "nhãn late lấy lại theo phần phạt đã ghi");
      assert.equal(res.body.data.penaltyAmount, 20000, "chốt hộ không xóa phần phạt đã tính");
      assert.equal(state.created, 0, "chốt hộ không tạo bản ghi mới");
      assert.equal(state.shift.status, "hoàn thành");
      assert.equal(sent.length, 1, "chốt hộ không sinh thêm thông báo");

      const rows = await WorkService.listAttendance({ employeeId: "u-emp-1" });
      assert.notEqual(rows[0].status, "missed", "sau khi chốt hộ thì ca không còn bị bỏ qua");
      assert.ok(rows[0].checkOut);
    });
  });
});

test("manager cùng chi nhánh chốt ra hộ ca đã bị bỏ qua: 200", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async () => {
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      const { res, thrown } = await callCheckout(
        { userId: "u-mgr-1", role: "manager", branchSlug: "cn-a" },
        { employeeId: "u-emp-1", shiftId: "CA-1" }
      );
      assert.equal(thrown, null, `manager cùng chi nhánh phải chốt được, nhận ${JSON.stringify(res.body)}`);
      assert.equal(res.statusCode, 200);
      // Không có `time` thì lấy giờ do server tính, không bịa; chỉ cần checkOut đã ghi.
      assert.ok(res.body.data.checkOut);
      assert.equal(state.attendances[0].checkOut, res.body.data.checkOut);
    });
  });
});

test("manager khác chi nhánh chốt hộ ca đã bị bỏ qua -> 403", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      const { res, thrown } = await callCheckout(
        { userId: "u-mgr-2", role: "manager", branchSlug: "cn-b" },
        { employeeId: "u-emp-1", shiftId: "CA-1", time: "19:00", branchSlug: "cn-a" }
      );
      assert.equal(thrown && thrown.status, 403);
      assert.equal(res.statusCode, 0);
      assert.equal(state.attendances[0].checkOut, null, "bị chặn thì ca vẫn chưa được ghi công");
      assert.equal(sent.length, 1);
    });
  });
});

test("nhân viên tự chốt ra ca đã bị bỏ qua -> 400, bản ghi vẫn mở", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      await WorkService.listAttendance({ employeeId: "u-emp-1" });
      const { res, thrown } = await callCheckout(
        { userId: "u-emp-1", role: "staff", branchSlug: "cn-a" },
        { employeeId: "u-emp-1", shiftId: "CA-1", time: "19:00" }
      );
      assert.equal(thrown && thrown.status, 400);
      assert.equal(thrown && thrown.code, "VALIDATION_ERROR");
      assert.match(thrown.message, /Ca đã quá hạn chốt ra nên bị bỏ qua/);
      assert.equal(res.statusCode, 0);
      assert.equal(state.attendances[0].checkOut, null);
      assert.equal(state.attendances[0].status, "missed");
      assert.equal(sent.length, 1, "chốt thất bại không sinh thêm thông báo");

      // Chốt hộ vẫn còn làm được sau lần nhân viên bị từ chối.
      const ok = await callCheckout(
        { userId: "u-mgr-1", role: "manager", branchSlug: "cn-a" },
        { employeeId: "u-emp-1", shiftId: "CA-1", time: "19:00" }
      );
      assert.equal(ok.thrown, null, JSON.stringify(ok.res.body));
      assert.equal(ok.res.body.data.checkOut, "19:00");
    });
  });
});

test("integration-service lỗi: đọc chấm công vẫn trả dữ liệu, không sập 500", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow()] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(
      async () => {
        const rows = await WorkService.listAttendance({ employeeId: "u-emp-1" });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, "missed");
        assert.equal(rows[0].checkOut, null);
        assert.equal(state.attendances[0].status, "missed", "ghi status vẫn thành công dù gửi thông báo hỏng");

        const { res, thrown } = await callCheckout(
          { userId: "u-admin-1", role: "admin", branchSlug: null },
          { employeeId: "u-emp-1", shiftId: "CA-1", time: "19:00" }
        );
        assert.equal(thrown, null, `lỗi thông báo không được chặn chốt hộ, nhận ${JSON.stringify(res.body)}`);
      },
      { fail: true }
    );
  });
});

test("lỗi DB khi lưu status missed: đọc ném 500, không nuốt lỗi Prisma", async () => {
  const stub = {
    attendanceConfig: { findUnique: async () => ({ id: "default", checkoutWindowMinutes: 60 }) },
    shift: { findUnique: async () => shiftRow(), findMany: async () => [shiftRow()] },
    attendance: {
      findMany: async () => [attendanceRow()],
      update: async () => {
        throw new Error("connection closed");
      },
    },
  };
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      await assert.rejects(
        () => WorkService.listAttendance({ employeeId: "u-emp-1" }),
        (err) => err.status === 500 && err.code === "INTERNAL_SERVER_ERROR"
      );
      assert.equal(sent.length, 0, "ghi thất bại thì chưa báo, lần đọc sau sẽ báo lại");
    });
  });
});

test("listAttendance (Postgres): lỗi đọc DB ném 500, không rơi xuống danh sách memory", async () => {
  // Bản ghi memory để chứng minh nhánh cũ sẽ trả về dữ liệu bộ nhớ khi DB lỗi.
  const memRow = await WorkService.checkin({ employeeId: "u-emp-memory-leak", checkinTime: "08:00" });
  assert.ok(memRow.id);
  const stub = {
    attendanceConfig: { findUnique: async () => ({ id: "default", checkoutWindowMinutes: 60 }) },
    shift: { findUnique: async () => null, findMany: async () => [] },
    attendance: {
      findMany: async () => {
        throw new Error("connection closed");
      },
    },
  };
  await withFakePrisma(stub, async () => {
    // Trước khi sửa, nhánh catch chỉ console.error rồi rơi xuống memoryAttendances
    // -> HTTP 200 với bản ghi bộ nhớ (hoặc mảng rỗng khi payroll đọc theo tháng).
    await assert.rejects(
      () => WorkService.listAttendance({ employeeId: "u-emp-memory-leak" }),
      (err) => err.status === 500 && err.code === "INTERNAL_SERVER_ERROR"
    );
  });
});

test("checkout chỉ chốt bản ghi của hôm nay, không đóng nhầm ca còn mở của hôm trước", async () => {
  const yesterday = toVnDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const today = toVnDate(now);
  const { stub, state } = makeDb({
    attendances: [
      attendanceRow({ id: "att-old", date: yesterday, shiftId: null }),
      attendanceRow({ id: "att-new", date: today, shiftId: null }),
    ],
  });
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkout({ employeeId: "u-emp-1", checkoutTime: hhmm(now) });
    assert.equal(row.id, "att-new", "phải chốt bản ghi hôm nay");
    const old = state.attendances.find((a) => a.id === "att-old");
    assert.equal(old.checkOut, null, "ca mở của hôm trước phải vẫn còn mở, chờ quản lý/admin chốt hộ");
  });
});

test("không có bản ghi mở hôm nay: vẫn chốt được ca mở của tối qua (Ca Tối qua nửa đêm)", async () => {
  const yesterday = toVnDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const { stub, state } = makeDb({ attendances: [attendanceRow({ id: "att-old", date: yesterday, shiftId: null })] });
  await withFakePrisma(stub, async () => {
    const row = await WorkService.checkout({ employeeId: "u-emp-1", checkoutTime: hhmm(now) });
    assert.equal(row.id, "att-old");
    assert.equal(row.checkOut, hhmm(now));
    assert.equal(state.updated, 1);
  });
});

test("chốt hộ phải theo shiftId: đóng đúng ca bị bỏ qua, để nguyên bản ghi đang mở của hôm nay", async () => {
  const today = toVnDate(now);
  const { stub, state } = makeDb({
    shift: shiftRow({ id: "CA-OLD" }),
    attendances: [
      attendanceRow({ id: "att-today", shiftId: "CA-NEW", date: today, status: "late", penaltyAmount: 0 }),
      attendanceRow({ id: "att-old", shiftId: "CA-OLD", date: day, status: "missed" }),
    ],
  });
  await withFakePrisma(stub, async () => {
    const { res, thrown } = await callCheckout(
      { userId: "NV-0001", role: "admin", branchSlug: null },
      { employeeId: "u-emp-1", shiftId: "CA-OLD", time: "18:00" }
    );
    assert.equal(thrown, null);
    assert.equal(res.body.data.id, "att-old", "phải đóng ca được chỉ định, không đóng bản ghi hôm nay");
    assert.equal(res.body.data.checkOut, "18:00");
    // Chốt hộ thì ca được ghi công trở lại, phần phạt đi muộn đã ghi vẫn giữ.
    assert.equal(res.body.data.status, "late");
    assert.equal(res.body.data.penaltyAmount, 20000);
    const todayRow = state.attendances.find((a) => a.id === "att-today");
    assert.equal(todayRow.checkOut, null, "bản ghi đang mở của hôm nay phải còn nguyên");
    assert.equal(todayRow.status, "late");
  });
});

test("đọc nội bộ (payroll lập phiếu lương) chỉ chiếu trạng thái: không ghi DB, không bắn thông báo", async () => {
  const { stub, state } = makeDb({ shift: shiftRow(), attendances: [attendanceRow({ status: "late" })] });
  await withFakePrisma(stub, async () => {
    await withFakeNotification(async (sent) => {
      const internal = await WorkService.listAttendance({ employeeId: "u-emp-1", actor: null });
      assert.equal(internal[0].status, "missed", "vẫn phải lộ missed cho payroll tính đúng giờ công");
      assert.equal(sent.length, 0, "một lần đọc nội bộ không được bắn thông báo");
      assert.equal(state.updated, 0, "một lần đọc nội bộ không được ghi DB");

      const human = await WorkService.listAttendance({ employeeId: "u-emp-1", actor: "NV-0005" });
      assert.equal(human[0].status, "missed");
      assert.equal(sent.length, 1, "người thật mở danh sách thì mới ghi nhận và báo một lần");
      assert.equal(state.updated, 1);
      assert.equal(sent[0].branchSlug, "cn-a", "thông báo phải phạm vi chi nhánh, không phải broadcast");
    });
  });
});
