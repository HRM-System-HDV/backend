"use strict";

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const config = require("./config");
const { errorHandler } = require("./middlewares/errorHandler");
const {handler:h,service:s} = require("./controllers/IntegrationController");
const {actor} = require("./utils/access");

const app = express();

app.use(morgan("dev"));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "25mb" }));
// SOAP nhận và trả XML nguyên vẹn — không bọc {data}/{error}.
app.use(express.text({ limit: "1mb", type: ["text/xml", "application/xml", "application/soap+xml"] }));
app.use(cookieParser());

// Health check endpoint đúng chuẩn: { status: "ok", service: "...", time: "..." }
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: config.serviceName,
    time: new Date().toISOString(),
  });
});

app.use("/api",(req,_res,next)=>{try{req.actor=actor(req);next();}catch(e){next(e);}});
for(const [route,kind] of [["news","news"],["regulations","regulation"],["wifi-configs","wifiConfig"]]) {
  app.get(`/api/${route}`,h((req,who)=>s.contentList(kind,req.query,who)));
  app.post(`/api/${route}`,h((req,who)=>s.contentWrite(kind,null,req.body,who),201));
  app.get(`/api/${route}/:id`,h((req,who)=>s.contentGet(kind,req.params.id,who)));
  app.put(`/api/${route}/:id`,h((req,who)=>s.contentWrite(kind,req.params.id,req.body,who)));
  app.delete(`/api/${route}/:id`,h((req,who)=>s.contentDelete(kind,req.params.id,who)));
}
app.get("/api/requests",h((req,who)=>s.listRequests(req.query,who)));
app.post("/api/requests",h((req,who)=>s.createRequest(req.body,who),201));
app.get("/api/requests/:id",h((req,who)=>s.getRequest(req.params.id,who)));
for(const [action,approved,peer] of [["approve",true,false],["reject",false,false],["accept",true,true],["decline",false,true]]) app.put(`/api/requests/:id/${action}`,h((req,who)=>s.reviewRequest(req.params.id,approved,req.body || {},who,peer)));
app.delete("/api/requests/:id",h((req,who)=>s.deleteRequest(req.params.id,who)));
app.get("/api/notifications/settings",h((_req,who)=>s.notificationSettings(who)));
app.put("/api/notifications/settings",h((req,who)=>s.notificationSettings(who,req.body)));
app.post("/api/notifications/reminders",h((_req,who)=>s.reminders(who)));
app.get("/api/notifications",h(async(_req,who)=>{await s.reminders(who);return s.listNotifications(who);}));
app.post("/api/notifications",h((req,who)=>s.sendNotification(req.body,who),201));
app.put("/api/notifications/:id/read",h((req,who)=>s.readNotification(req.params.id,who)));
app.get("/api/soap-config",h((_req,who)=>s.soapConfig(who)));
app.put("/api/soap-config",h((req,who)=>s.soapConfig(who,req.body)));
app.post("/api/soap-config/ping",h((_req,who)=>s.ping(who)));
app.get("/api/backlog",h((_req,who)=>s.listBacklog(who)));
app.post("/api/backlog",h((req,who)=>s.backlog(req.body,who),201));
app.post("/api/upload",h(async(req,who)=>{
  if(req.body.regulationId) {require("./utils/access").manager(who);const row=await s.contentGet("regulation",req.body.regulationId,who);require("./utils/access").branch(who,row.scopeBranchId,true);}
  return require("./services/FileService").upload(req.body.file || req.body.dataUrl || req.body.base64 || req.body.image,req.body.folder,who.userId,who.branchId,req.body.regulationId);
},201));
app.use("/api/files", require("./routes/fileRoutes"));
// SOAP ngân hàng: chuyển tiếp nguyên vẹn body/headers/status XML.
app.use("/soap/payroll", require("./routes/soapRoutes"));

// Xử lý 404
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Không tìm thấy tài nguyên",
    },
  });
});

app.use(errorHandler);

module.exports = app;
