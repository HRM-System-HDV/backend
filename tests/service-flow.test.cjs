"use strict";

// Black-box HTTP: sáu tiến trình độc lập, chỉ memory test; không migration hoặc DB thật.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { randomUUID, createHmac } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const names = ["api-gateway", "identity-service", "organization-service", "work-service", "payroll-service", "integration-service"];
const processes = [];
const ports = {};
const jwtSecret = "isolated_http_flow_jwt_secret";
const internalToken = "isolated_http_flow_internal_secret";
let tempStorage;
function token(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ type: "access", exp: Math.floor(Date.now() / 1000) + 600, ...payload })}`;
  return `${unsigned}.${createHmac("sha256", jwtSecret).update(unsigned).digest("base64url")}`;
}
const admin = token({ userId: randomUUID(), role: "admin", clientPlatform: "web", name: "Quản trị viên" });
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const url = name => `http://127.0.0.1:${ports[name]}`;
async function call(method, route, body, bearer = admin, expected = 200) {
  const res = await fetch(`${url("api-gateway")}${route}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await res.json();
  assert.equal(res.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
  return result.data;
}

before(async () => {
  tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), "hrm-http-flow-"));
  for (const name of names) {
    let port;
    do { port = await freePort(); } while (Object.values(ports).includes(port));
    ports[name] = port;
  }
  for (const name of names) {
    const child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(root, name),
      env: {
        ...process.env, NODE_ENV: "test", DATABASE_URL: "", PORT: String(ports[name]), SERVICE_NAME: name,
        JWT_SECRET: jwtSecret, INTERNAL_API_TOKEN: internalToken,
        IDENTITY_URL: url("identity-service"), ORGANIZATION_URL: url("organization-service"),
        ORGANIZATION_SERVICE_URL: url("organization-service"), WORK_URL: url("work-service"),
        WORK_SERVICE_URL: url("work-service"), PAYROLL_URL: url("payroll-service"),
        PAYROLL_SERVICE_URL: url("payroll-service"), INTEGRATION_URL: url("integration-service"),
        INTEGRATION_SERVICE_URL: url("integration-service"), STORAGE_DIR: tempStorage,
        PUBLIC_BASE_URL: url("api-gateway"), RATE_LIMIT_MAX: "10000",
      },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const state = { name, child, output: "" };
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { state.output = (state.output + chunk.toString()).slice(-16000); });
    processes.push(state);
  }
  for (const state of processes) {
    const deadline = Date.now() + 20000;
    let ready = false;
    while (!ready && Date.now() < deadline && state.child.exitCode === null) {
      try { ready = (await fetch(`${url(state.name)}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `${state.name} failed to start: ${state.output}`);
  }
});

after(async () => {
  await Promise.all(processes.map(({ child }) => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
  })));
  if (tempStorage) {
    const resolved = path.resolve(tempStorage);
    const allowed = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(allowed) || !path.basename(resolved).startsWith("hrm-http-flow-")) throw new Error("Unexpected test storage path");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test("HTTP liên service: hồ sơ, ca, công việc, tích lũy, xác nhận và chi tiền", { timeout: 90000 }, async () => {
  const branch = await call("POST", "/api/branches", { name: "Chi nhánh A", address: "Hà Nội" }, admin, 201);
  const otherBranch = await call("POST", "/api/branches", { name: "Chi nhánh B", address: "Đà Nẵng" }, admin, 201);
  async function employee(email, branchId = branch.id) {
    return call("POST", "/api/employees", { name: email, email, branchId, salaryType: "hourly", salary: "30000", bankName: "Test", bankAccountNumber: email.split("@")[0], bankAccountName: email }, admin, 201);
  }
  const first = await employee("first@example.test");
  const second = await employee("second@example.test");
  const outsider = await employee("outsider@example.test", otherBranch.id);
  const users = await call("GET", "/api/auth/users");
  const firstUser = users.find(row => row.employeeId === first.id);
  assert.ok(firstUser, "Organization must synchronize Identity through HTTP");
  assert.notEqual(firstUser.id, first.id);
  const reset = await call("POST", "/api/auth/reset-password", { email: first.email });
  const login = await call("POST", "/api/auth/login", { email: first.email, password: reset.tempPassword, clientPlatform: "mobile" });
  const firstToken = login.accessToken;
  const secondToken = token({ userId: randomUUID(), employeeId: second.id, branchId: branch.id, role: "staff", clientPlatform: "mobile" });
  const outsiderToken = token({ userId: randomUUID(), employeeId: outsider.id, branchId: otherBranch.id, role: "staff", clientPlatform: "mobile" });

  // Gán quản lý chi nhánh phải xác minh vai trò tài khoản qua Identity thật.
  await call("PUT", `/api/branches/${branch.id}`, { managerId: first.id }, admin, 400);
  const secondUser = users.find(row => row.employeeId === second.id);
  await call("PUT", `/api/auth/users/${secondUser.id}`, { systemRole: "manager" });
  const candidates = await call("GET", `/api/branches/${branch.id}/manager-candidates`);
  assert.deepEqual(candidates.map(row => row.id), [second.id]);
  const assigned = await call("PUT", `/api/branches/${branch.id}`, { managerId: second.id });
  assert.equal(assigned.manager, second.name);
  assert.equal(assigned.staff, 2);

  const template = await call("POST", "/api/shift-templates", { templateCode: "TEST-AM", name: "Ca sáng", startTime: "07:00", endTime: "12:00" }, admin, 201);
  const workDate = "2026-01-10";
  const shift = await call("POST", "/api/shifts", { employeeId: first.id, branchId: branch.id, workDate, templateId: template.id }, admin, 201);
  await call("POST", "/api/shifts", { employeeId: first.id, branchId: branch.id, workDate, templateId: template.id }, admin, 409);
  await call("POST", "/api/shifts", { employeeId: second.id, branchId: branch.id, workDate, templateId: template.id }, admin, 201);
  const attendance = await call("PUT", `/api/attendance/${shift.id}`, { checkIn: `${workDate}T07:00:00+07:00`, checkOut: `${workDate}T12:00:00+07:00` });
  assert.ok(attendance.checkIn && attendance.checkOut);

  const common = await call("POST", "/api/tasks", { title: "Công việc chung", branchId: branch.id, workDate, templateId: template.id }, admin, 201);
  const personal = await call("POST", "/api/tasks", { title: "Công việc cá nhân", assignedTo: first.id }, admin, 201);
  const secondTasks = await call("GET", "/api/tasks", undefined, secondToken);
  assert.ok(secondTasks.some(task => task.id === common.id));
  assert.ok(!secondTasks.some(task => task.id === personal.id));
  await call("PUT", `/api/tasks/${common.id}`, { status: "done" }, firstToken);
  assert.equal((await call("GET", "/api/tasks", undefined, secondToken)).find(task => task.id === common.id).status, "done");
  assert.equal((await call("GET", "/api/tasks", undefined, outsiderToken)).length, 0);

  await call("POST", "/api/wifi-configs", { ssid: "HRM-A", bssid: "aa:bb:cc:dd:ee:01", branchId: branch.id }, admin, 201);
  await call("POST", "/api/attendance/checkin", { shiftId: shift.id, wifi: { bssid: "aa:bb:cc:dd:ee:99" } }, firstToken, 403);

  const form = await call("POST", "/api/requests", { type: "work_supplement", employeeId: first.id, title: "Đề nghị", content: "Đề nghị xem lại công", sourceShiftId: shift.id, requestedCheckIn: `${workDate}T06:00:00+07:00` }, firstToken, 201);
  const reviewed = await call("PUT", `/api/requests/${form.id}/approve`, {});
  assert.equal(reviewed.reviewedByName, "Quản trị viên");
  const unchanged = await call("GET", `/api/attendance?employeeId=${first.id}&month=2026-01`);
  assert.equal(new Date(unchanged[0].checkIn).getTime(), new Date(`${workDate}T07:00:00+07:00`).getTime(), "Approving form must not modify Attendance");

  await call("PUT", `/api/employees/${first.id}`, { salary: "40000" });
  const payslip = await call("POST", "/api/payroll/payslips/generate", { employeeId: first.id, month: "2026-01" }, admin, 201);
  assert.equal(String(payslip.baseSalary), "200000");
  const bank = await call("POST", "/api/payroll/bank-accounts", { accountNumber: "123456", accountName: "HRM", bankName: "Test", balance: "1000000", isPrimary: true }, admin, 201);
  const payoutBody = { payslipIds: [payslip.id], debitAccountId: bank.id, idempotencyKey: randomUUID(), content: "Chi lương test" };
  await call("POST", "/api/payroll/payouts", payoutBody, admin, 400);
  await call("POST", `/api/payroll/payslips/${payslip.id}/confirm`, {}, firstToken);
  const payout = await call("POST", "/api/payroll/payouts", payoutBody, admin, 201);
  const duplicate = await call("POST", "/api/payroll/payouts", payoutBody, admin, 200);
  assert.equal(payout.id, duplicate.id);
  const accounts = await call("GET", "/api/payroll/bank-accounts");
  assert.equal(String(accounts.find(row => row.id === bank.id).balance), "800000");

  // SOAP phải đi qua Gateway -> Integration -> Payroll, không dùng stub trả thành công.
  const secondShifts = await call("GET", `/api/shifts?employeeId=${second.id}`);
  await call("PUT", `/api/attendance/${secondShifts[0].id}`, { checkIn: `${workDate}T07:00:00+07:00`, checkOut: `${workDate}T12:00:00+07:00` });
  const secondSlip = await call("POST", "/api/payroll/payslips/generate", { employeeId: second.id, month: "2026-01" }, admin, 201);
  await call("POST", `/api/payroll/payslips/${secondSlip.id}/confirm`, {}, secondToken);
  const soapKey = randomUUID();
  const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><PayoutRequest><idempotencyKey>${soapKey}</idempotencyKey><debitAccount>123456</debitAccount><content>SOAP test</content><totalAmount>150000</totalAmount><beneficiaryCount>1</beneficiaryCount><payslipId>${secondSlip.id}</payslipId></PayoutRequest></soap:Body></soap:Envelope>`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${url("api-gateway")}/soap/payroll`, { method: "POST", headers: { Authorization: `Bearer ${admin}`, "Content-Type": "text/xml" }, body: xml, signal: AbortSignal.timeout(10000) });
    const body = await res.text();
    assert.equal(res.status, 200, body);
    assert.match(res.headers.get("content-type"), /xml/);
    assert.match(body, /PayoutResponse/);
    assert.doesNotMatch(body, /Fault/);
  }
  assert.equal(String((await call("GET", "/api/payroll/bank-accounts")).find(row => row.id === bank.id).balance), "650000");

  await call("POST", "/api/news", { title: "Branch only", summary: "Summary", content: "Content", publishDate: workDate, tag: "test", branchId: branch.id }, admin, 201);
  assert.equal((await call("GET", "/api/news", undefined, outsiderToken)).length, 0);
  await call("POST", "/api/notifications", { title: "Removed", body: "Test" }, admin, 404);
  await call("POST", "/api/notifications/reminders", {}, admin, 404);
  await call("POST", "/api/attendance/preflight", {}, admin, 404);
  const notices = await call("GET", "/api/notifications", undefined, firstToken);
  const notice = notices.find(row => row.requestId === form.id);
  assert.ok(notice, "Duyệt đơn tự tạo thông báo dù không còn POST thông báo riêng");
  await call("PUT", `/api/notifications/${notice.id}/read`, {}, firstToken);
  const secondForm = await call("POST", "/api/requests", {type: "advance", title: "Ứng lương", content: "Đề nghị", advanceAmount: "1000"}, secondToken, 201);
  await call("PUT", `/api/requests/${secondForm.id}/approve`, {});
  const secondNotice = (await call("GET", "/api/notifications", undefined, secondToken)).find(row => row.requestId === secondForm.id);
  assert.equal(secondNotice.isRead, false);
  assert.ok(!(await call("GET", "/api/notifications", undefined, outsiderToken)).some(row => [form.id, secondForm.id].includes(row.requestId)));
});
