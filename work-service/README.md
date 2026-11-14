# Work service

Ca mẫu, phân ca, nguyện vọng đăng ký, chấm công và công việc theo `docs/BUSINESS.md` và `prisma/schema.prisma`.

## Chạy và kiểm tra

- `npm install`, `npm run prisma:generate`, `npm start`.
- `npm test`: domain và HTTP, dùng memory/stub client; không đọc/ghi DB thật.
- `DATABASE_URL` trống: memory dành cho dev/test. Có URL nhưng kết nối lỗi thì dừng, không chuyển sang memory.
- Không seed tự động hoặc migrate khi khởi động. Thiết kế hiện cần migration được duyệt trước khi dùng DB mới.

## Danh tính và gọi nội bộ

Gateway chuyển `x-user-id`, `x-employee-id`, `x-user-role`, `x-branch-id`, `x-user-name` sau xác thực. User ID khác employee ID; staff chỉ thao tác hồ sơ của mình, manager đúng chi nhánh, admin toàn quyền.

Peer service dùng `x-internal-token` khớp `INTERNAL_API_TOKEN` để đọc nội bộ. Token nội bộ không cho thay đổi ca, công, task hoặc cấu hình. Service phải triển khai sau mạng/Gateway tin cậy; không phơi trực tiếp các header danh tính cho client công cộng.

Org được gọi tại `ORGANIZATION_SERVICE_URL` để lấy nhân viên hiện tại. Integration được gọi tại `INTEGRATION_SERVICE_URL` để kiểm tra Wi-Fi, ghi Backlog và dọn ảnh. Timeout 5000ms, không đọc DB service khác.

## HTTP canonical

Thành công `{data,message}`, lỗi `{error:{code,message}}`; UUID cho ID, ngày `YYYY-MM-DD`, kỳ `YYYY-MM`, timestamp ISO có timezone. Không nhận `branchSlug`, tên ca làm ID hoặc chuỗi ngày cũ.

| Tuyến | Dữ liệu chính |
|---|---|
| `GET/POST /api/shift-templates`, `PUT/DELETE /api/shift-templates/:id` | `templateCode,name,startTime,endTime`; giờ `HH:mm`. |
| `GET/POST /api/shifts`, `GET/PUT/DELETE /api/shifts/:id` | Tạo bằng `employeeId,templateId,workDate,note?`; chụp giờ từ ca mẫu. Query `employeeId,branchId,workDate,month`. |
| `POST /api/shifts/:id/assign` | `employeeId`, chỉ ca chưa bắt đầu/chưa chấm công. |
| `GET /api/shifts/registrations`, `POST /api/shifts/register`, `DELETE /api/shifts/registrations/:id` | `employeeId?,templateId,registerDate`; staff buộc employee của phiên. |
| `GET/PUT /api/attendance/config` | User admin hoặc đọc bằng internal token; chỉ các thuộc tính Prisma hiện tại. |
| `POST /api/attendance/checkin`, `/api/attendance/checkout` | `{shiftId,employeeId?,wifi:{bssid,ssid?}}`; dùng giờ server, không nhận giờ do nhân viên chọn. |
| `POST /api/attendance/double` | `{shiftId,nextShiftId,employeeId?,wifi:{bssid,ssid?}}`; một transaction ghi checkout trước/check-in sau ở mốc nối. |
| `PUT /api/attendance/:shiftId` | Admin/manager chọn `{checkIn,checkOut,penaltyNote?}` trên ca hiện có. Không cần endpoint chấm công hộ hoặc duyệt đơn để tự điền giờ. |
| `GET /api/attendance` | Query `employeeId,branchId,month,workDate`; đọc nội bộ cho Payroll. |
| `GET/POST /api/tasks`, `PUT/DELETE /api/tasks/:id` | Riêng: `assignedTo`; chung: `branchId,workDate,templateId`. Staff chỉ sửa `status,proofPhotoUrl` của task mình được phép xem. |

`GET attendance` giữ dữ liệu chấm công và kèm `shift`, `complete`, `workedSeconds`, `earnedSalary` (chuỗi Decimal chưa làm tròn), `penaltyAmount` (VNĐ). Ca thiếu cặp vào–ra có earned/penalty = 0. Các giá trị được tính lại theo hồ sơ lương/cấu hình hiện tại; Payroll giữ bản chụp khi xác nhận phiếu.

Task chung có một trạng thái/kết quả chung, một người hoàn thành thì cả ca thấy xong. Task riêng gán thẳng, không có bước nhận việc. Task yêu cầu ảnh không được đánh dấu xong khi thiếu minh chứng.

`dueDate` là timestamp ISO có múi giờ, lưu bằng `TIMESTAMPTZ(3)`; API giữ cả giờ và phút. Client cũ gửi `YYYY-MM-DD` vẫn được nhận, hiểu là 00:00 tại Việt Nam. Migration `20261113180000_task_deadline_timestamp` chuyển hạn cũ sang 00:00 cùng ngày tại Việt Nam; dữ liệu cũ không có giờ để khôi phục.

Khi đọc nhiệm vụ, BE tra `photoSubmittedBy` (users.id) qua `IDENTITY_SERVICE_URL` và trả thêm `photoSubmittedByName`. Tuyến tra tên trong Identity chỉ nhận token nội bộ và chỉ trả mã/tên. Nếu tài khoản không còn hoặc Identity tạm ngừng, tên trả `null`; nhiệm vụ và ảnh vẫn đọc được. `photoSubmittedAt` là giờ nộp ảnh, không phải thời điểm chụp.

Không còn archive hoặc route cũ trùng chức năng. Ghi chấm công thủ công gửi audit tới Integration sau khi lưu; nếu Integration lỗi thì ghi cảnh báo server, không báo thất bại giả cho bản ghi đã lưu. Chưa có cơ chế đảm bảo audit xuyên DB khi dịch vụ nhận nhật ký ngừng hoạt động.
