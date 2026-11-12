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
