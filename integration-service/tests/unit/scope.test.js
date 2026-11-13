"use strict";
process.env.DATABASE_URL="";
process.env.INTERNAL_API_TOKEN="scope-test-secret";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const db=require("../../src/config/database");
const clients=require("../../src/clients/ServiceClient");
const {matchesWhere}=require("../../src/utils/where");
const s=require("../../src/services/IntegrationService");

const branchA=randomUUID(),branchB=randomUUID();
const employeeA={id:randomUUID(),branchId:branchA,status:"đang làm"};
const employeeB={id:randomUUID(),branchId:branchB,status:"đang làm"};
const admin={userId:randomUUID(),role:"admin",name:"Admin"};
const manager={userId:randomUUID(),role:"manager",branchId:branchA,name:"Quản lý"};
const staff={userId:randomUUID(),employeeId:employeeA.id,role:"staff",branchId:branchA};

// Q-E-01: phạm vi chi nhánh phải nằm trong WHERE của truy vấn Prisma.
test("Q-E-01: bảng tin và đơn lọc phạm vi chi nhánh ngay trong WHERE của Prisma",async()=>{
  const original=db.getPrisma;
  const calls=[];
  const newsRows=[
    {id:randomUUID(),title:"Toàn thể",branchId:null},
    {id:randomUUID(),title:"Chi nhánh A",branchId:branchA},
    {id:randomUUID(),title:"Chi nhánh B",branchId:branchB},
  ];
  const requestRows=[
    {id:randomUUID(),employeeId:employeeA.id,targetEmployeeId:null,branchId:branchA},
    {id:randomUUID(),employeeId:employeeB.id,targetEmployeeId:null,branchId:branchB},
    {id:randomUUID(),employeeId:employeeB.id,targetEmployeeId:employeeA.id,branchId:branchB},
  ];
  // DB giả lập: findMany chỉ trả về dòng khớp WHERE (mô phỏng đúng hành vi Postgres).
  db.getPrisma=()=>({
    news:{findMany:async args=>{calls.push(args);return newsRows.filter(row=>matchesWhere(row,args.where));}},
    request:{findMany:async args=>{calls.push(args);return requestRows.filter(row=>matchesWhere(row,args.where));}},
  });
  try {
    const news=await s.contentList("news",{},staff);
    // WHERE của truy vấn phải chứa điều kiện phạm vi (toàn thể + chi nhánh của tôi).
    assert.deepEqual(calls[0].where.OR,[{branchId:null},{branchId:branchA}]);
    assert.equal(news.length,2);
    assert.ok(!news.some(row=>row.branchId===branchB),"không được lộ bảng tin chi nhánh khác");
    // Admin xem được toàn bộ, không lọc phạm vi.
    const all=await s.contentList("news",{},admin);
    assert.deepEqual(calls[1].where,{});
    assert.equal(all.length,3);
    // Lọc theo branchId trong query vẫn giữ đúng phạm vi (toàn thể + chi nhánh được hỏi).
    await s.contentList("news",{branchId:branchB},staff);
    assert.deepEqual(calls[2].where.AND[0].OR,[{branchId:null},{branchId:branchA}]);
    assert.deepEqual(calls[2].where.AND[1].OR,[{branchId:branchB},{branchId:null}]);
    // Đơn: staff thấy đơn của mình trong chi nhánh mình; quản lý thấy đơn chi nhánh mình.
    const requests=await s.listRequests({},staff);
    assert.ok(requests.length>=1);
    assert.ok(!requests.some(row=>row.branchId===branchB&&row.employeeId!==employeeA.id),"không được lộ đơn chi nhánh khác");
    const managerRequests=await s.listRequests({},manager);
    assert.deepEqual(calls[calls.length-1].where,{branchId:branchA});
    assert.ok(managerRequests.every(row=>row.branchId===branchA));
    // Admin không bị lọc phạm vi.
    await s.listRequests({},admin);
    assert.deepEqual(calls[calls.length-1].where,{});
  } finally {db.getPrisma=original;}
});

test("Q-E-01: quy định dùng scopeBranchId, Wi-Fi nội bộ chỉ đọc cấu hình hoạt động",async()=>{
  const original=db.getPrisma;
  const calls=[];
  const regulationRows=[
    {id:randomUUID(),regulationCode:"QD-A",scopeBranchId:branchA},
    {id:randomUUID(),regulationCode:"QD-B",scopeBranchId:branchB},
    {id:randomUUID(),regulationCode:"QD-ALL",scopeBranchId:null},
  ];
  const wifiRows=[
    {id:randomUUID(),ssid:"Office",branchId:branchA,status:"hoạt động"},
    {id:randomUUID(),ssid:"Old",branchId:branchA,status:"vô hiệu hóa"},
  ];
  db.getPrisma=()=>({
    regulation:{findMany:async args=>{calls.push(args);return regulationRows.filter(row=>matchesWhere(row,args.where));}},
    wifiConfig:{findMany:async args=>{calls.push(args);return wifiRows.filter(row=>matchesWhere(row,args.where));}},
  });
  try {
    const list=await s.contentList("regulation",{},staff);
    assert.deepEqual(calls[0].where.OR,[{scopeBranchId:null},{scopeBranchId:branchA}]);
    assert.equal(list.length,2);
    assert.ok(!list.some(row=>row.scopeBranchId===branchB),"không được lộ quy định chi nhánh khác");
    const wifi=await s.contentList("wifiConfig",{},{internal:true});
    assert.deepEqual(calls[1].where,{status:"hoạt động"});
    assert.equal(wifi.length,1);
    assert.equal(wifi[0].ssid,"Office");
  } finally {db.getPrisma=original;}
});

// Q-E-02: fanout thông báo phải ghi nguyên tử.
test("Q-E-02: lỗi giữa chừng khi fanout không để lại dòng thông báo thừa",async()=>{
  const original=db.getPrisma;
  const originalEmployees=clients.employees;
  const committed=[];
  let usedTransaction=false;
  db.getPrisma=()=>({
    notification:{
      // Ghi ngoài transaction: nếu service quên dùng transaction thì dòng sẽ lọt vào committed.
      create:async({data})=>{const row={id:randomUUID(),...data};committed.push(row);return row;},
    },
    // Mô phỏng transaction của Postgres: chỉ commit khi callback thành công.
    $transaction:async fn=>{
      usedTransaction=true;
      const staged=[];
      const tx={notification:{create:async({data})=>{
        if(data.targetEmployeeId===employeeB.id) throw new Error("Lỗi ghi dòng thứ hai");
        const row={id:randomUUID(),...data};
        staged.push(row);
        return row;
      }}};
      const result=await fn(tx);
      committed.push(...staged);
      return result;
    },
  });
  clients.employees=async()=>[employeeA,employeeB];
  try {
    await assert.rejects(s.sendNotification({title:"Tin chung",body:"Nội dung"},admin),/Lỗi ghi dòng thứ hai/);
    assert.equal(usedTransaction,true,"fanout phải chạy trong transaction");
    assert.equal(committed.length,0,"không được ghi dòng thông báo thừa khi lỗi giữa chừng");
  } finally {db.getPrisma=original;clients.employees=originalEmployees;}
});

test("Q-E-02: fanout thành công ghi đủ một dòng cho mỗi người nhận",async()=>{
  const original=db.getPrisma;
  const originalEmployees=clients.employees;
  const committed=[];
  db.getPrisma=()=>({
    notification:{create:async({data})=>{const row={id:randomUUID(),...data};committed.push(row);return row;}},
    $transaction:async fn=>fn({notification:{create:async({data})=>{const row={id:randomUUID(),...data};committed.push(row);return row;}}}),
  });
  clients.employees=async()=>[employeeA,employeeB];
  try {
    const rows=await s.sendNotification({title:"Tin chung",body:"Nội dung"},admin);
    assert.equal(rows.length,2);
    assert.equal(committed.length,2);
    assert.deepEqual(committed.map(row=>row.targetEmployeeId).sort(),[employeeA.id,employeeB.id].sort());
  } finally {db.getPrisma=original;clients.employees=originalEmployees;}
});

// PHỐI HỢP Q-B-01: không phụ thuộc mùa vào việc work-service trả attendance.
test("đổi ca: không xác định được trạng thái chấm công thì chặn, không coi là chưa chấm công",async()=>{
  const originalShift=clients.shift;
  const originalShifts=clients.shifts;
  const originalEmployee=clients.employee;
  const originalConfig=clients.attendanceConfig;
  const source={id:randomUUID(),employeeId:employeeA.id,workDate:"2099-01-01",templateId:randomUUID(),scheduledStart:"07:00",scheduledEnd:"12:00",status:"đang làm"};
  clients.shift=async()=>source;
  clients.shifts=async()=>[]; // không tìm được ca trong danh sách -> không xác định được
  clients.employee=async id=>id===employeeA.id?employeeA:{...employeeB,branchId:branchA};
  clients.attendanceConfig=async()=>({shiftSwapMode:"manager_approval"});
  try {
    await assert.rejects(s.createRequest({type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:employeeB.id},staff),/Không xác định được trạng thái chấm công/);
    // Có attendance => xác định được, không chặn vì lý do trạng thái chấm công.
    clients.shift=async()=>({...source,attendance:null});
    clients.shifts=async()=>[];
    const row=await s.createRequest({type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:employeeB.id},staff);
    assert.equal(row.status,"pending");
    // Đã chấm công thì chặn đổi ca.
    clients.shift=async()=>({...source,attendance:{checkIn:"2099-01-01T07:00:00Z",checkOut:null}});
    await assert.rejects(s.createRequest({type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:employeeB.id},staff),/chưa chấm công/);
  } finally {clients.shift=originalShift;clients.shifts=originalShifts;clients.employee=originalEmployee;clients.attendanceConfig=originalConfig;}
});

test("đổi ca: thiếu attendance thì lấy trạng thái từ danh sách ca (GET /api/shifts?employeeId=)",async()=>{
  const originalShift=clients.shift;
  const originalShifts=clients.shifts;
  const originalEmployee=clients.employee;
  const originalConfig=clients.attendanceConfig;
  const source={id:randomUUID(),employeeId:employeeA.id,workDate:"2099-01-01",templateId:randomUUID(),scheduledStart:"07:00",scheduledEnd:"12:00",status:"đang làm"};
  clients.shift=async()=>source; // getShiftById chưa trả attendance
  clients.shifts=async query=>query.employeeId===employeeA.id?[{...source,attendance:{checkIn:"2099-01-01T07:00:00Z",checkOut:null}}]:[];
  clients.employee=async id=>id===employeeA.id?employeeA:{...employeeB,branchId:branchA};
  clients.attendanceConfig=async()=>({shiftSwapMode:"manager_approval"});
  try {
    await assert.rejects(s.createRequest({type:"shift_swap",title:"Đổi ca",content:"Nhờ làm thay",sourceShiftId:source.id,targetEmployeeId:employeeB.id},staff),/chưa chấm công/);
  } finally {clients.shift=originalShift;clients.shifts=originalShifts;clients.employee=originalEmployee;clients.attendanceConfig=originalConfig;}
});
