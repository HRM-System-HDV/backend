# HRM Backend — SOA

Backend đồ án quản lý nhân sự, triển khai theo [nghiệp vụ đã chốt](../docs/BUSINESS.md) và năm schema Prisma. Đợt tái cấu trúc chỉ thay đổi BE; Web/Mobile cần cập nhật hợp đồng API riêng sau đó.

## Các service

| Service | Cổng | DB riêng | Phụ trách |
|---|---|---|---|
| api-gateway | 4000 | Không có | JWT, phân quyền route, proxy REST/SOAP |
| identity-service | 4001 | hrm_identity | Tài khoản, vai trò, phiên và thiết bị |
| organization-service | 4002 | hrm_organization | Chi nhánh, phòng ban, vị trí, hồ sơ và thỏa thuận lương |
| work-service | 4003 | hrm_work | Lịch ca, chấm công Wi-Fi/thường/kép, công việc |
| payroll-service | 4004 | hrm_payroll | Tích lũy lương, xác nhận phiếu, số dư và lệnh chi |
| integration-service | 4005 | hrm_integration | Mẫu đơn, thông báo, nội dung, Wi-Fi, tệp, nhật ký và SOAP |

Node.js >= 18, Express, Prisma/PostgreSQL. Kiến trúc phẳng Route → Controller → Service → Prisma. Không có repository chung, DB chung hoặc import mã nguồn xuyên service.

## Cài đặt và kiểm tra

Mỗi service có package riêng. Trong `backend/`:

```sh
npm run install:all
npm run prisma:generate
npm test
```

Các script gốc chạy trên Windows và Unix. Với PowerShell chặn `npm.ps1`, dùng `npm.cmd`.

- `prisma:generate` chỉ sinh client, không tạo bảng hoặc sửa dữ liệu.
- Migration `20261112230000_hrm_uuid_redesign` đã được tạo cho cả năm DB. Nó chỉ thay cấu trúc cũ khi các bảng nghiệp vụ đều trống; nếu có bản ghi thì dừng và yêu cầu migration dữ liệu riêng. Không dùng reset để vượt kiểm tra này.
- Migration đã áp dụng trên năm DB local trong đợt tái cấu trúc. Triển khai ở môi trường khác dùng `npm run prisma:deploy` sau khi kiểm tra DB đích. Không tự chạy seed để tạo tài khoản/mật khẩu mặc định.
- Test dùng dữ liệu cô lập, không chứng minh migration hay truy vấn trên DB thật đã chạy thành công.
- Migration mới chứa các CHECK/index đã chốt. `npm run test:database` kiểm chứng ghi dữ liệu và ràng buộc trên DB cấu hình trong `.env`, rồi rollback toàn bộ bản ghi thử; cần Postgres đang chạy. `npm run test:flow` chạy sáu service HTTP cô lập bằng memory, không kết nối DB thật.

## Hợp đồng quản lý chi nhánh

- FE tạo/sửa bằng `{ name, address, managerId, status }`; `address` bắt buộc, `status` chỉ nhận `hoạt động` hoặc `vô hiệu hóa`. Khi tạo, `managerId` để `null`; sau đó gán nhân viên vào chi nhánh rồi chọn quản lý.
- BE trả thêm `manager` (tên từ hồ sơ nhân sự), `staff` (số nhân viên `đang làm`, bao gồm quản lý), `branchCode` và `createdAt`. Không gửi `manager`, `staff` hoặc `branchCode` trong payload ghi.
- Admin thao tác mọi chi nhánh. Manager được tạo và xem danh sách, chỉ sửa/xóa chi nhánh mang `branchId` trong phiên đăng nhập. Staff không ghi chi nhánh.
- `GET /api/branches/:id/manager-candidates` trả `{ id, name, systemRole }` của nhân viên đang làm tại chi nhánh, có tài khoản Manager/Admin. BE xác minh vai trò qua Identity cả khi liệt kê lẫn khi gán; chức danh nhân sự không quyết định quyền.
- `POST /api/auth/internal/employee-roles` chỉ dành cho kết nối service bằng token nội bộ, tối đa 500 employee ID mỗi lần; gateway chặn truy cập từ bên ngoài.

## Cấu hình và chạy

Sao chép `.env.example` thành `.env` riêng của từng service rồi điền giá trị local. Không commit `.env` thật. `docker-compose.yml` chỉ mô tả hạ tầng năm Postgres riêng trên các cổng 5433–5437; không tự khởi chạy hoặc reset DB khi test.

Trong mỗi service:

```sh
npm run dev
```

Gateway cần các URL Identity/Organization/Work/Payroll/Integration. Mỗi service có `GET /health` trả tên service và thời điểm. Cấu hình DATABASE_URL phải trỏ DB của chính service đó.

## Hợp đồng danh tính nội bộ

Gateway xác thực JWT rồi xóa header danh tính do client tự gửi trước khi chuyển tiếp:

| Header | Giá trị từ token đã xác thực |
|---|---|
| x-user-id | User.id của Identity |
| x-employee-id | Employee.id của Organization; không đồng nhất với User.id |
| x-branch-id | Branch.id UUID |
| x-user-role | admin / manager / staff |
| x-user-email, x-user-name | Thông tin hiển thị người thao tác |

- Token có `userId`, `employeeId`, `branchId`, `role` và `clientPlatform`.
- Staff chỉ đăng nhập Mobile, dùng access token Bearer mang platform đã ký; không có phiên cookie Web cho staff. Admin/manager có thể dùng Web/Mobile theo quyền nghiệp vụ.
- Vai trò kiểm tra tại Gateway và service; quyền đối với bản ghi/chi nhánh/cá nhân do service kiểm tra.
- `INTERNAL_API_TOKEN` là cấu hình chung cho các cuộc gọi nội bộ qua header `x-internal-token`, timeout tối đa 5000ms. Gateway không chuyển tiếp token nội bộ do client gửi.
- Tên tiếng Việt trong `x-user-name` được URI-encode khi gửi header và decode ở service nhận; không gửi Unicode thô trong HTTP header.
- Không dùng slug hoặc tên làm khóa liên kết. API dùng UUID; ngày nghiệp vụ phía client là `DD/MM/YYYY`, kỳ lương `MM-YYYY`. Gọi nội bộ có credential giữ ngày ISO và kỳ `YYYY-MM`; DB giữ kiểu ngày gốc. Mốc thời gian có giờ/múi giờ vẫn là ISO. Tiền dùng Decimal và được tuần tự hóa thành chuỗi.
- Phân ca nhận `branchId`, `employeeId`, `templateId`, `workDate`; chi nhánh phải khớp nhân viên. Giờ ca lấy từ ca mẫu; không còn trường `note`. Migration `20261113170000_shift_branch_contract` thêm chi nhánh và bỏ cột ghi chú cũ.

## Các luồng phải giữ đúng

- Đúng Wi-Fi mới được mở các ca trong ngày trên Mobile; BE kiểm tra lại khi chấm công. Wi-Fi là cấu hình theo chi nhánh nhân viên, không phải thuộc tính từng Shift.
- Mỗi ca một cặp vào–ra; ca liền kề không phải ca chồng giờ. Chấm công kép ghi ra ca trước/vào ca sau đúng mốc nối trong một transaction.
- Hết hạn checkout không tự điền giờ ra hoặc cộng lương. Admin/manager có quyền nhập giờ trực tiếp trên ca; duyệt mẫu đơn không làm thao tác đó thay họ.
- Task riêng giao trực tiếp. Task chung theo chi nhánh/ngày/ca mẫu dùng chung một kết quả hoàn thành.
- Chỉ công hoàn thành hợp lệ mới có lương. Parttime = salary × giờ gốc; fulltime = salary / standardWorkDays mỗi ca. Phạt phần trăm, ca thiếu công không bị trừ thêm phạt.
- Phiếu lương cần xác nhận bởi chủ sở hữu/manager đúng phạm vi/admin trước khi chi. Xác nhận chưa trừ số dư.
- Mẫu đơn chỉ ghi nhận đề nghị/kết quả, không tự sửa lịch, công, lương hay chi tiền.
- Thông báo/bản tin/quy định lọc theo chi nhánh hoặc toàn thể.
- Đã loại khỏi phạm vi: archive/restore, các trường slug/updatedAt cũ, phạt tiền cố định và nhiều lượt vào–ra trong cùng ca.

## REST và SOAP chi lương

Gateway chuyển `/api/payroll/*` tới Payroll, `/soap/payroll` tới Integration. WSDL qua GET `/soap/payroll?wsdl`; lệnh chi SOAP là POST XML, trả XML hoặc Fault, không bọc JSON.

Mọi lệnh chi cần `idempotencyKey`, tài khoản nguồn và phiếu lương đã xác nhận. Thành công trừ số dư mô phỏng đúng một lần; lặp cùng lệnh trả kết quả cũ. Thiếu số dư là `INSUFFICIENT_FUNDS` (REST 422 hoặc SOAP Fault). Payout.id là UUID, mã nghiệp vụ bankReference có dạng `GD-...`.

Không sử dụng tài khoản hoặc mật khẩu mẫu ghi trong tài liệu cũ làm thông tin đăng nhập môi trường thật. Seed chỉ được chạy chủ động sau khi schema/migration và dữ liệu khởi tạo được chốt.

## Giới hạn vận hành hiện tại

- `PUT /api/notifications/read-all` đánh dấu các thông báo chưa đọc của chính nhân viên trong phiên; tài khoản chưa gắn hồ sơ trả `{ count: 0 }`.
- Admin sửa phiếu chưa xác nhận qua `PUT /api/payroll/payslips/:id` với `bonus`, `totalPenalty` và `adjustmentReason`. `totalPenalty` là tổng phạt nhập trực tiếp, thay thế mức tự tính; gửi `null` để dùng lại mức phạt từ chấm công. Giá trị nhập được giữ khi xác nhận và chi lương. Phiếu đã xác nhận/đã thanh toán không được sửa. Cần migration `20261113150000_payslip_manual_penalty` và sinh lại Prisma Client.

- Nhắc chấm công được tạo khi client lấy thông báo/gọi nhắc giờ; chưa có scheduler hoặc push nền khi ứng dụng không hoạt động.
- Nhật ký thao tác nhập giờ ở Work được gửi sang Integration theo best-effort; nếu Integration ngừng hoạt động, lưu công thành công không bị báo thất bại giả.
- Để kiểm chứng DB sau khi khởi động lại năm Postgres local, chạy `npm run test:database`. Bộ test mặc định và test HTTP xuyên service không cần DB thật.
