# HRM Enterprise — Core Server (Express Microservices SOA)

Hệ thống Backend trung tâm cho nền tảng quản trị nhân sự **HRM Enterprise**. Được xây dựng theo kiến trúc **Hướng dịch vụ (SOA / Microservices)**, tuân thủ nguyên tắc **Database-per-Service** với 5 cơ sở dữ liệu PostgreSQL độc lập trên hạ tầng Docker.

---

## 🏗 Kiến trúc Hệ thống

```text
[ Client (Web Portal / Mobile App) ]
                │
                ▼ (HTTP REST / Cookies)
     ┌──────────────────────┐
     │  API Gateway (:4000) │  (Stateless, JWT Verify, Rate Limit, CORS)
     └──────────┬───────────┘
                │ Proxy nội bộ
   ┌────────────┼────────────┬────────────┬────────────┐
   ▼            ▼            ▼            ▼            ▼
Identity   Organization     Work       Payroll    Integration
 (:4001)      (:4002)      (:4003)     (:4004)      (:4005)
   │            │            │            │            │
   ▼            ▼            ▼            ▼            ▼
Postgres     Postgres     Postgres     Postgres     Postgres
 (5433)       (5434)       (5435)       (5436)       (5437)
```

---

## 📦 Danh sách Microservices

| Service | Port | Database Container | Database Port | Trách nhiệm chính |
|---|:---:|---|:---:|---|
| **API Gateway** | `4000` | *Không (Stateless)* | - | Cửa ngõ duy nhất, xác thực JWT tập trung, định tuyến proxy, rate limiting |
| **Identity Service** | `4001` | `hrm-db-identity` | `5433` | Quản lý tài khoản, mã hóa mật khẩu bcrypt, phiên làm việc, thiết bị |
| **Organization Service** | `4002` | `hrm-db-organization` | `5434` | Cơ cấu tổ chức, chi nhánh, phòng ban, thông tin nhân sự chi tiết |
| **Work Service** | `4003` | `hrm-db-work` | `5435` | Ca làm việc mẫu, xếp ca, đăng ký ca, chấm công Wi-Fi, vi phạm, tác vụ |
| **Payroll Service** | `4004` | `hrm-db-payroll` | `5436` | Tài khoản doanh nghiệp, tổng hợp công, bảng lương, lệnh chi tiền |
| **Integration Service** | `4005` | `hrm-db-integration` | `5437` | SOAP WSDL ngân hàng, đơn từ, bảng tin, quy chế, Wi-Fi chi nhánh, upload ảnh |

---

## 🛠 Công nghệ sử dụng

- **Runtime:** Node.js (>= 18.x)
- **Framework:** Express.js
- **ORM & Database:** Prisma ORM, PostgreSQL 16 Alpine
- **Giao thức & Tích hợp:** HTTP REST API, SOAP/XML WSDL, JWT (`jsonwebtoken`), bcryptjs
- **Hạ tầng:** Docker & Docker Compose (quản lý 5 cụm cơ sở dữ liệu độc lập)

---

## 🌳 Cấu trúc Thư mục Repository

```text
backend/
├── docker-compose.yml          # Hạ tầng 5 container PostgreSQL độc lập
├── package.json                # Root package & scripts
├── api-gateway/                # API Gateway trung tâm (:4000)
│   ├── src/                    # Middleware proxy, rate limiter, JWT verify
│   └── server.js
├── identity-service/           # Identity Service (:4001)
│   ├── prisma/                 # Schema & Seed tài khoản
│   └── src/                    # Controller, Service, Validator, Routes
├── organization-service/       # Organization Service (:4002)
│   ├── prisma/                 # Schema chi nhánh, phòng ban, hồ sơ nhân sự
│   └── src/
├── work-service/               # Work Service (:4003)
│   ├── prisma/                 # Schema ca kíp, chấm công, vi phạm
│   └── src/
├── payroll-service/            # Payroll Service (:4004)
│   ├── prisma/                 # Schema bảng lương, tính lương, chi trả
│   └── src/
└── integration-service/        # Integration Service (:4005)
    ├── prisma/                 # Schema đơn từ, thông báo, quy chế, Wi-Fi
    └── src/                    # SOAP Bank Simulator, REST APIs
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### Bước 0: Khởi động 5 Database Containers bằng Docker Compose
Dự án sử dụng cơ chế Database-per-Service. Mỗi service kết nối tới một node PostgreSQL độc lập trên các cổng từ `5433` đến `5437`.

```bash
# Khởi động toàn bộ 5 container DB trong nền
docker compose up -d

# Kiểm tra trạng thái các container (đảm bảo cả 5 container đều Up)
docker compose ps
```

### Bước 1: Khởi động API Gateway (Port 4000)
```bash
cd api-gateway
npm install
npm run dev
```

### Bước 2: Khởi động các Microservices (Mở các terminal riêng)
Mỗi service đều có file `.env.example` và file `.env` đã được chuẩn bị sẵn. Hãy tiến hành push schema và nạp dữ liệu mẫu:

```bash
# 1. Identity Service (Port 4001)
cd identity-service
npm install
npx prisma db push
node prisma/seed.js
npm run dev

# 2. Organization Service (Port 4002)
cd organization-service
npm install
npx prisma db push
node prisma/seed.js
npm run dev

# 3. Work Service (Port 4003)
cd work-service
npm install
npx prisma db push
node prisma/seed.js
npm run dev

# 4. Payroll Service (Port 4004)
cd payroll-service
npm install
npx prisma db push
node prisma/seed.js
npm run dev

# 5. Integration Service (Port 4005)
cd integration-service
npm install
npx prisma db push
npm run dev
```

### Bước 3: Chạy Kiểm thử (Tests)
Từng microservice được tích hợp bộ unit test và integration test với Jest:

```bash
# Chạy test trong thư mục của service tương ứng
npm test
```

---

## 🏦 Tích hợp Cổng Ngân hàng (SOAP Bank Simulator)

Hệ thống tích hợp giả lập cổng ngân hàng phục vụ đối soát và chi lương tự động:
- **Lấy WSDL:** `GET http://localhost:4005/soap/payroll?wsdl`
- **Gửi lệnh chi (SOAP XML):** `POST http://localhost:4005/soap/payroll`
- **Cơ chế chống trùng (Idempotency):** Mỗi lệnh chi bắt buộc kèm `idempotencyKey`. Nếu nhận trùng key, hệ thống trả về kết quả đối soát `BANK-*` đã lưu thay vì trừ tiền lần 2.

---

## 🔑 Tài khoản khởi tạo sẵn (Seed Data)

| Email | Mật khẩu | Vai trò | Chức vụ |
|---|---|---|---|
| `admin@company.com` | `123456` | Admin | Giám đốc điều hành |
| `manager@company.com` | `123456` | Manager | Quản lý chi nhánh HN-1 |
| `nhanvien@company.com` | `123456` | Staff | Nhân viên thu ngân HN-1 |

---

## 🔗 Liên kết hệ sinh thái HRM Enterprise

- **Web Portal (Next.js):** [HRM-QuanLyDuAn/frontend](https://github.com/HRM-QuanLyDuAn/frontend)
- **Mobile App (Flutter):** [HRM-QuanLyDuAn/mobile](https://github.com/HRM-QuanLyDuAn/mobile)
