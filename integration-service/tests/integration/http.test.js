"use strict";
process.env.DATABASE_URL="";process.env.INTERNAL_API_TOKEN="http-test-secret";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const request=require("supertest");
const app=require("../../src/app");
const userId=randomUUID(),branchId=randomUUID();
const headers={"x-user-id":userId,"x-user-role":"admin"};
test("health và xác thực, không có archive",async()=>{
  const res=await request(app).get("/health").expect(200);assert.equal(res.body.service,"integration-service");
  await request(app).get("/api/news").expect(401);
  await request(app).get("/api/archive/integration/requests").set(headers).expect(404);
  await request(app).get("/api/wifi-configs").set("x-internal-token","wrong").expect(401);
});
test("CRUD Wi-Fi và đọc từ Work bằng credential nội bộ",async()=>{
  await request(app).post("/api/wifi-configs").set({...headers,"x-user-role":"manager","x-branch-id":branchId}).send({ssid:"Office",bssid:"aa:bb:cc:dd:ee:11",branchId}).expect(403);
  const created=await request(app).post("/api/wifi-configs").set(headers).send({ssid:"Office",bssid:"aa:bb:cc:dd:ee:11",branchId}).expect(201);
  const list=await request(app).get(`/api/wifi-configs?branchId=${branchId}`).set("x-internal-token","http-test-secret").expect(200);assert.equal(list.body.data[0].id,created.body.data.id);
});
test("SOAP luôn XML Fault khi sai quyền hoặc thiếu phiếu",async()=>{
  const response=await request(app).post("/soap/payroll").set("Content-Type","text/xml").send("<Envelope><Body><PayoutRequest/></Body></Envelope>").expect(400);
  assert.match(response.headers["content-type"],/xml/);assert.match(response.text,/Fault/);
  const wsdl=await request(app).get("/soap/payroll?wsdl").expect(200);assert.match(wsdl.text,/payslipId/);
});
test("Backlog chỉ credential nội bộ được ghi, admin được xem",async()=>{
  const payload={userId,userName:"Admin",userRole:"admin",action:"attendance.manual",module:"work",entityType:"attendance",entityId:randomUUID(),targetName:"Ca sáng"};
  await request(app).post("/api/backlog").set(headers).send(payload).expect(403);
  await request(app).post("/api/backlog").set("x-internal-token","http-test-secret").send(payload).expect(201);
  const result=await request(app).get("/api/backlog").set(headers).expect(200);assert.equal(result.body.data[0].action,payload.action);
});

test("regulation expiry dates round-trip and can be cleared; managers only mutate their branch", async () => {
  const manager = { ...headers, "x-user-role": "manager", "x-branch-id": branchId };
  const payload = { regulationCode: "EXPIRY-1", title: "Expiry", category: "Rules", summary: "Summary", content: "Content", effectiveDate: "13/11/2026", expiryDate: "30/11/2026", scopeBranchId: branchId };
  const created = (await request(app).post("/api/regulations").set(manager).send(payload).expect(201)).body.data;
  assert.equal(created.expiryDate, "30/11/2026");
  const read = (await request(app).get(`/api/regulations/${created.id}`).set(manager).expect(200)).body.data;
  assert.equal(read.expiryDate, "30/11/2026");
  await request(app).put(`/api/regulations/${created.id}`).set(manager).send({ expiryDate: "12/11/2026" }).expect(400);
  const cleared = (await request(app).put(`/api/regulations/${created.id}`).set(manager).send({ expiryDate: null }).expect(200)).body.data;
  assert.equal(cleared.expiryDate, null);
  const global = (await request(app).post("/api/regulations").set(headers).send({ ...payload, regulationCode: "GLOBAL-1", scopeBranchId: null }).expect(201)).body.data;
  await request(app).get(`/api/regulations/${global.id}`).set(manager).expect(200);
  await request(app).put(`/api/regulations/${global.id}`).set(manager).send({ title: "Denied" }).expect(403);
  await request(app).put(`/api/regulations/${global.id}`).set(manager).send({ pinned: true }).expect(403);
  await request(app).delete(`/api/regulations/${global.id}`).set(manager).expect(403);
  await request(app).put(`/api/regulations/${global.id}`).set(headers).send({ pinned: true }).expect(200);
});

test("news allows urgent announcements without pinning and restricts company mutations to admin", async () => {
  const manager = { ...headers, "x-user-role": "manager", "x-branch-id": branchId };
  const payload = { title: "Urgent", summary: "Summary", content: "Content", publishDate: "13/11/2026", tag: "Khẩn cấp", pinned: false, branchId };
  const own = (await request(app).post("/api/news").set(manager).send(payload).expect(201)).body.data;
  assert.equal(own.pinned, false);
  await request(app).put(`/api/news/${own.id}`).set(manager).send({ pinned: true }).expect(200);
  const unpinned = (await request(app).put(`/api/news/${own.id}`).set(manager).send({ pinned: false }).expect(200)).body.data;
  assert.equal(unpinned.pinned, false);
  const company = (await request(app).post("/api/news").set(headers).send({ ...payload, branchId: null }).expect(201)).body.data;
  await request(app).get(`/api/news/${company.id}`).set(manager).expect(200);
  await request(app).put(`/api/news/${company.id}`).set(manager).send({ title: "Denied" }).expect(403);
  await request(app).put(`/api/news/${company.id}`).set(manager).send({ pinned: true }).expect(403);
  await request(app).delete(`/api/news/${company.id}`).set(manager).expect(403);
  await request(app).put(`/api/news/${company.id}`).set(headers).send({ pinned: true }).expect(200);
});

test("manual notification POST routes are removed while settings remain available", async () => {
  for (const path of ["/api/notifications", "/api/notifications/reminders"]) await request(app).post(path).set(headers).send({}).expect(404);
  await request(app).get("/api/notifications/settings").set(headers).expect(200);
});

test("admin saves SOAP config, pings WSDL, and config changes clear old ping status", async (t) => {
  const payload = {endpointUrl:"https://bank.example/soap",wsdlUrl:"https://bank.example/soap?wsdl",serviceName:"Payroll",securityMode:"TLS",certExpiry:null};
  await request(app).put("/api/soap-config").set(headers).send(payload).expect(200);
  const calls = [];
  t.mock.method(global, "fetch", async url => {calls.push(url);return {ok:true,body:{cancel:async()=>{}}};});
  const ping = (await request(app).post("/api/soap-config/ping").set(headers).send({}).expect(200)).body.data;
  assert.equal(ping.status,"healthy");assert.ok(ping.lastPingTime);assert.match(ping.avgResponseTime,/ms$/);assert.deepEqual(calls,[payload.wsdlUrl]);
  const changed = (await request(app).put("/api/soap-config").set(headers).send({...payload,endpointUrl:"https://other.example/soap"}).expect(200)).body.data;
  assert.equal(changed.status,"unknown");assert.equal(changed.lastPingTime,null);
  await request(app).put("/api/soap-config").set({...headers,"x-user-role":"manager"}).send(payload).expect(403);
});

test("only managers in scope may delete pending requests; processed requests are retained", async (t) => {
  const clients = require("../../src/clients/ServiceClient");
  const employeeId = randomUUID();
  t.mock.method(clients, "employee", async () => ({id:employeeId,branchId,status:"đang làm"}));
  const payload = {type:"advance",employeeId,title:"Request to delete",content:"Reason",advanceAmount:"1000"};
  const created = (await request(app).post("/api/requests").set(headers).send(payload).expect(201)).body.data;
  const path = `/api/requests/${created.id}`;
  const manager = {...headers,"x-user-role":"manager","x-branch-id":branchId};
  await request(app).delete(path).set({...manager,"x-branch-id":randomUUID()}).expect(403);
  await request(app).delete(path).set({...manager,"x-user-role":"staff","x-employee-id":employeeId}).expect(403);
  await request(app).delete(path).set(manager).expect(200);
  await request(app).get(path).set(headers).expect(404);
  const processed = (await request(app).post("/api/requests").set(headers).send(payload).expect(201)).body.data;
  await request(app).put(`/api/requests/${processed.id}/approve`).set(headers).send({}).expect(200);
  await request(app).delete(`/api/requests/${processed.id}`).set(headers).expect(400);
  const retained = (await request(app).get(`/api/requests/${processed.id}`).set(headers).expect(200)).body.data;
  assert.equal(retained.status,"approved");
});
