"use strict";
process.env.DATABASE_URL="";
process.env.INTERNAL_API_TOKEN="test-internal-token";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const db=require("../../src/config/database");
const clients=require("../../src/clients/ServiceClient");
const s=require("../../src/services/IntegrationService");
const soap=require("../../src/services/SoapService");
const branchA=randomUUID(),branchB=randomUUID();
const employeeA={id:randomUUID(),branchId:branchA,status:"đang làm"},employeeB={id:randomUUID(),branchId:branchB,status:"đang làm"};
const admin={userId:randomUUID(),role:"admin",name:"Admin"};
const manager={userId:randomUUID(),role:"manager",branchId:branchA,name:"Quản lý"};
const staff={userId:randomUUID(),employeeId:employeeA.id,role:"staff",branchId:branchA};
clients.employee=async id=>[employeeA,employeeB].find(e=>e.id===id);
clients.employees=async query=>[employeeA,employeeB].filter(e=>!query.branchId || e.branchId===query.branchId);
clients.shifts=async()=>[];
// Mặc định giả lập work-service đổi lịch thành công; test nào cần thì ghi lời gọi lại.
const swapCalls=[];
clients.swapShifts=async(body)=>{swapCalls.push(body);return{source:null,target:null};};
test("bản tin chi nhánh/toàn thể và quyền manager",async()=>{
  await s.contentWrite("news",null,{title:"Toàn thể",summary:"Tóm tắt",content:"Nội dung",publishDate:"2026-11-12",tag:"tin",branchId:null},admin);
  const row=await s.contentWrite("news",null,{title:"Chi nhánh",summary:"Tóm tắt",content:"Nội dung",publishDate:"2026-11-12",tag:"tin",branchId:branchA},manager);
  assert.equal((await s.contentList("news",{},staff)).length,2);
  assert.equal((await s.contentList("news",{},{...staff,branchId:branchB})).length,1);
  await assert.rejects(s.contentWrite("news",row.id,{branchId:branchB},manager),/chi nhánh/);
  await assert.rejects(s.contentWrite("news",null,{title:"fake"},staff),/quyền/);
});
test("thông báo fanout và đã đọc độc lập",async()=>{
  const rows=await s.sendNotification({branchId:null,title:"Tin chung",body:"Thông báo"},admin);
  assert.equal(rows.length,2);
  await s.readNotification(rows[0].id,staff);
  assert.equal((await s.listNotifications(staff))[0].isRead,true);
  assert.equal((await s.listNotifications({...staff,employeeId:employeeB.id}))[0].isRead,false);
  await assert.rejects(s.readNotification(rows[1].id,staff),/người khác/);
});
test("đơn tạm ứng là mẫu đơn và người xử lý lấy từ phiên",async()=>{
  const request=await s.createRequest({type:"advance",title:"Ứng lương",content:"Đề nghị",advanceAmount:"100000"},staff);
  assert.equal(request.employeeId,employeeA.id);
  assert.equal(request.branchId,branchA);
  const result=await s.reviewRequest(request.id,true,{reviewedBy:"fake"},manager);
  assert.equal(result.status,"approved");assert.equal(result.reviewedBy,manager.userId);assert.ok(result.reviewedAt);
  await assert.rejects(s.reviewRequest(request.id,true,{},admin),/đã được xử lý/);
});
test("bổ sung công được duyệt không gọi API ghi ca",async()=>{
  const shiftId=randomUUID();clients.shift=async()=>({id:shiftId,employeeId:employeeA.id});
  const request=await s.createRequest({type:"work_supplement",title:"Bổ sung",content:"Quên ra ca",sourceShiftId:shiftId,requestedCheckOut:"2026-11-12T10:00:00Z"},staff);
  const result=await s.reviewRequest(request.id,true,{},admin);
  assert.equal(result.status,"approved");assert.equal(result.sourceShiftId,shiftId);
});

test("manager không đọc đơn chưa có chi nhánh; tiền tạm ứng tuân thủ Decimal 15 chữ số",async()=>{
  await assert.rejects(s.createRequest({type:"advance",title:"Amount",content:"Test",advanceAmount:"1000000000000000"},staff),/15/);
  const previous=clients.employee;
  try {
    clients.employee=async()=>({...employeeA,branchId:null});
    const row=await s.createRequest({type:"advance",employeeId:employeeA.id,title:"No branch",content:"Test",advanceAmount:"1000"},admin);
    await assert.rejects(s.getRequest(row.id,manager),/chi nhánh/);
  } finally {clients.employee=previous;}
});
test("đổi ca trùng lịch bị từ chối và chỉ nhân viên đích chấp nhận ở đúng chế độ",async()=>{
  const target={...employeeB,branchId:branchA};clients.employee=async id=>id===employeeA.id?employeeA:target;
  const source={id:randomUUID(),employeeId:employeeA.id,workDate:"2099-01-01",templateId:randomUUID(),scheduledStart:"07:00",scheduledEnd:"12:00",status:"đang làm",attendance:null};
  clients.shift=async()=>source;clients.shifts=async()=>[{...source,id:randomUUID(),employeeId:target.id}];
  const body={type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:target.id};
  await assert.rejects(s.createRequest(body,staff),/đã có ca/);
  clients.shifts=async()=>[];clients.attendanceConfig=async()=>({shiftSwapMode:"mutual_acceptance"});
  const row=await s.createRequest(body,staff);
  const before=swapCalls.length;
  await assert.rejects(s.reviewRequest(row.id,true,{},staff,true),/quyền/);
  assert.equal(swapCalls.length,before,"người không phải đích không được đổi lịch");
  assert.equal(row.status,"pending");
  const result=await s.reviewRequest(row.id,true,{}, {...staff,userId:randomUUID(),employeeId:target.id},true);
  assert.equal(result.status,"approved");
  assert.equal(swapCalls.length,before+1,"chấp nhận đơn đổi ca phải đổi lịch thật ở work-service");
  assert.deepEqual(swapCalls[before],{sourceShiftId:source.id,targetShiftId:null,targetEmployeeId:target.id});
});
test("work-service từ chối đổi lịch thì đơn vẫn còn pending và không gửi kết quả",async()=>{
  const target={...employeeB,branchId:branchA};const previousEmployee=clients.employee;clients.employee=async id=>id===employeeA.id?employeeA:target;
  const source={id:randomUUID(),employeeId:employeeA.id,workDate:"2099-01-01",templateId:randomUUID(),scheduledStart:"07:00",scheduledEnd:"12:00",status:"đang làm",attendance:null};
  clients.shift=async()=>source;clients.shifts=async()=>[];clients.attendanceConfig=async()=>({shiftSwapMode:"manager_approval"});
  const row=await s.createRequest({type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:target.id},staff);
  const before=swapCalls.length;
  const previousSwap=clients.swapShifts;
  clients.swapShifts=async()=>{throw Object.assign(new Error("Chỉ được hoán đổi ca chưa đến giờ và chưa chấm công"),{status:409});};
  await assert.rejects(s.reviewRequest(row.id,true,{},manager),/chưa đến giờ/);
  assert.equal(swapCalls.length,before,"work-service phải được gọi và từ chối");
  assert.equal((await s.getRequest(row.id,manager)).status,"pending","lịch chưa đổi thì đơn không được ghi approved");
  clients.swapShifts=previousSwap;clients.employee=previousEmployee;
});
test("Wi-Fi nội bộ lọc chi nhánh, chỉ admin được ghi",async()=>{
  const row=await s.contentWrite("wifiConfig",null,{ssid:"Office",bssid:"aa:bb:cc:dd:ee:ff",branchId:branchA},admin);
  assert.equal((await s.contentList("wifiConfig",{branchId:branchA},{internal:true}))[0].id,row.id);
  assert.equal((await s.contentList("wifiConfig",{branchId:branchB},{internal:true})).length,0);
  await assert.rejects(s.contentWrite("wifiConfig",row.id,{ssid:"Hacked"},manager),/admin/);
});
test("SOAP 0đ đi tới tầng Payroll, số âm vẫn bị từ chối (Q-E-04)",()=>{
  const id=randomUUID();
  const xml=`<Envelope><Body><PayoutRequest><idempotencyKey>k</idempotencyKey><debitAccount>123</debitAccount><totalAmount>0</totalAmount><payslipId>${id}</payslipId></PayoutRequest></Body></Envelope>`;
  // PHIẾU 0đ là nghiệp vụ hợp lệ (REST/payroll đã cho chi để đóng phiếu, Q-D-02):
  // parse KHÔNG được tự chặn, lỗi phải để Payroll quyết định.
  const zero=soap.parsePayoutRequest(xml);
  assert.equal(zero.error,undefined);
  assert.equal(zero.data.totalAmount,"0");
  // Số âm vẫn phải chặn ngay ở SOAP vì tài khoản ngân hàng không thể trừ âm.
  const negative=soap.parsePayoutRequest(xml.replace("<totalAmount>0</totalAmount>","<totalAmount>-1000</totalAmount>"));
  assert.ok(negative.error);assert.match(negative.error,/Tổng tiền chi không được âm/);
  assert.equal(soap.parsePayoutRequest(xml.replace("<totalAmount>0</totalAmount>","<totalAmount>abc</totalAmount>")).error,"Tổng tiền chi không được âm");
  // Hành vi cũ phải giữ nguyên: request không có PayoutRequest -> fault, không phải data.
  const missing=soap.parsePayoutRequest("<Envelope><Body></Body></Envelope>");
  assert.ok(missing.error);assert.match(missing.error,/thiếu PayoutRequest/);
  assert.match(soap.buildSoapFault(missing.error),/<faultcode>soap:Client<\/faultcode>/);
});
test("Prisma viết đúng UUID, kiểu ngày, không còn slug/updatedAt/width",async()=>{
  const original=db.getPrisma;let created;
  db.getPrisma=()=>({news:{create:async({data})=>{created=data;return {id:randomUUID(),...data};}}});
  try {await s.contentWrite("news",null,{title:"Tin",summary:"Tóm tắt",content:"Nội dung",publishDate:"2026-11-12",tag:"tin",branchId:null},admin);assert.ok(created.publishDate instanceof Date);assert.equal(created.authorId,admin.userId);assert.equal(created.branchSlug,undefined);assert.equal(created.updatedAt,undefined);} finally {db.getPrisma=original;}
});
test("SOAP cần phiếu đã xác nhận, giữ số tiền dạng chuỗi và chặn DTD",()=>{
  const id=randomUUID();const xml=`<Envelope><Body><PayoutRequest><idempotencyKey>k</idempotencyKey><debitAccount>123</debitAccount><totalAmount>150000</totalAmount><payslipId>${id}</payslipId></PayoutRequest></Body></Envelope>`;
  const parsed=soap.parsePayoutRequest(xml);assert.deepEqual(parsed.data.payslipIds,[id]);assert.equal(parsed.data.totalAmount,"150000");
  assert.ok(soap.parsePayoutRequest(xml.replace(`<payslipId>${id}</payslipId>`,"")).error);
  assert.ok(soap.parsePayoutRequest(`<!DOCTYPE test>${xml}`).error);
  assert.match(soap.buildWsdl("http://example/soap/payroll"),/payslipId/);
});

test("attendance reminder settings still control automatic reminder creation", async () => {
  const previous = clients.shifts;
  const shiftId = randomUUID();
  clients.shifts = async () => [{id:shiftId,employeeId:employeeA.id,workDate:"2099-01-01",scheduledStart:"12:00",scheduledEnd:"17:00",status:"đang làm",attendance:null}];
  try {
    const now = new Date("2099-01-01T11:00:00+07:00");
    await s.notificationSettings(staff,{checkInBefore1Hour:false});
    assert.equal((await s.reminders(staff,now)).length,0);
    await s.notificationSettings(staff,{checkInBefore1Hour:true});
    assert.equal((await s.reminders(staff,now)).length,1);
    assert.equal((await s.reminders(staff,now)).length,0,"Không tạo nhắc trùng");
  } finally {clients.shifts=previous;}
});

test("request deletion is pending-only and uses an atomic status condition", async () => {
  const previous=db.getPrisma;
  const id=randomUUID();
  let where;
  db.getPrisma=()=>({request:{findUnique:async()=>({id,status:"pending",branchId:branchA,employeeId:employeeA.id}),deleteMany:async(args)=>{where=args.where;return{count:0};}}});
  try {
    await assert.rejects(s.deleteRequest(id,manager),{status:409});
    assert.deepEqual(where,{id,status:"pending"});
  } finally {db.getPrisma=previous;}
});
