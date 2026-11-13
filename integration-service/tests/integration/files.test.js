"use strict";
const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hrm-integration-files-"));
process.env.DATABASE_URL="";process.env.STORAGE_DIR=dir;
const {test,after}=require("node:test");const assert=require("node:assert/strict");const {randomUUID}=require("node:crypto");
const request=require("supertest");const app=require("../../src/app");const database=require("../../src/config/database");
const admin={"x-user-id":randomUUID(),"x-user-role":"admin"};
const staff={"x-user-id":randomUUID(),"x-user-role":"staff","x-employee-id":randomUUID(),"x-branch-id":randomUUID()};
const dataUrl="data:image/png;base64,"+Buffer.from([137,80,78,71,13,10,26,10,0]).toString("base64");
after(()=>{const resolved=fs.realpathSync(dir);if(!resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"hrm-integration-files-"))throw new Error("Invalid cleanup target");fs.rmSync(resolved,{recursive:true,force:true});});
test("upload dùng publicId riêng, đọc đúng quyền và PDF quy định có relation",async()=>{
  const uploaded=await request(app).post("/api/upload").set(staff).send({file:dataUrl,folder:"hrm/cccd"}).expect(201);
  assert.ok(uploaded.body.data.publicId.startsWith("hrm/cccd/"));assert.equal(uploaded.body.data.width,undefined);
  await request(app).get(`/api/files/${uploaded.body.data.publicId}`).set(staff).expect(200);
  await request(app).get(`/api/files/${uploaded.body.data.publicId}`).set({...staff,"x-user-id":randomUUID()}).expect(403);
  await request(app).delete(`/api/files/${uploaded.body.data.publicId}`).set(staff).expect(403);
  const regulation=(await request(app).post("/api/regulations").set(admin).send({regulationCode:"QD-1",title:"Nội quy",category:"Quy định",summary:"Tóm tắt",content:"Nội dung",effectiveDate:"2026-11-12",scopeBranchId:staff["x-branch-id"]}).expect(201)).body.data;
  const pdf="data:application/pdf;base64,"+Buffer.from("%PDF-1.4\nfile").toString("base64");
  await request(app).post("/api/upload").set(admin).send({file:pdf,folder:"hrm/regulations",regulationId:regulation.id}).expect(201);
  const read=(await request(app).get(`/api/regulations/${regulation.id}`).set(staff).expect(200)).body.data;
  assert.equal(read.files.length,1);assert.equal(read.files[0].mime,"application/pdf");
  assert.notEqual(read.files[0].id,read.files[0].publicId);
  const downloaded = await request(app).get(`/api/files/${read.files[0].publicId}`).set(staff).expect(200);
  assert.match(downloaded.headers["content-type"], /application\/pdf/);
  assert.equal(downloaded.body.toString(), "%PDF-1.4\nfile");
  await request(app).get(`/api/files/${read.files[0].publicId}`).set({ ...staff, "x-branch-id": randomUUID() }).expect(403);
  await request(app).delete(`/api/files/${read.files[0].publicId}`).set(admin).expect(200);
  const afterDelete = (await request(app).get(`/api/regulations/${regulation.id}`).set(staff).expect(200)).body.data;
  assert.equal(afterDelete.files.length, 0);
});
test("Prisma FileAsset ghi publicId, UUID và đúng tên cột",async()=>{
  const original=database.getPrisma;let data;
  database.getPrisma=()=>({fileAsset:{create:async args=>{data=args.data;return data;}}});
  try {
    const result=await require("../../src/services/FileService").upload(dataUrl,"hrm/tasks",staff["x-user-id"],staff["x-branch-id"]);
    assert.equal(data.publicId,result.publicId);assert.match(data.id,/^[0-9a-f-]{36}$/);assert.equal(data.branchId,staff["x-branch-id"]);assert.equal(data.branchSlug,undefined);assert.equal(data.width,undefined);
  } finally {database.getPrisma=original;}
});
