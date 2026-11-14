"use strict";
require("dotenv").config();
const {PrismaClient}=require("@prisma/client");
async function main() {
  const branchId=process.env.SEED_WIFI_BRANCH_ID;
  if(!branchId) {console.log("Không có SEED_WIFI_BRANCH_ID; không tự tạo dữ liệu mẫu.");return;}
  const ssid=process.env.SEED_WIFI_SSID,bssid=process.env.SEED_WIFI_BSSID;
  if(!/^[0-9a-f-]{36}$/i.test(branchId) || !ssid || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(bssid || "")) throw new Error("Cần branch UUID, SSID và BSSID hợp lệ để seed Wi-Fi.");
  const prisma=new PrismaClient();
  try {if(!await prisma.wifiConfig.findFirst({where:{branchId,bssid:bssid.toLowerCase()}})) await prisma.wifiConfig.create({data:{branchId,ssid,bssid:bssid.toLowerCase(),status:"hoạt động"}});} finally {await prisma.$disconnect();}
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
