-- Cho phép lệnh chi 0đ để ĐÓNG trạng thái phiếu lương có thực lĩnh bằng 0.
--
-- Lý do (Q-D-02): BUSINESS.md §8.1 quy định luồng trạng thái
--   Chưa xác nhận -> Đã xác nhận -> Đã thanh toán
-- và KHÔNG có thao tác "hủy chi"/"đóng phiếu". Trước đây BE chặn netSalary <= 0
-- nên phiếu đã xác nhận có thực lĩnh 0 bị kẹt vĩnh viễn, không có đường thoát.
-- Với lệnh chi 0đ: không trừ tiền tài khoản nguồn, chỉ ghi nhận thanh toán và
-- chuyển phiếu sang "đã thanh toán".
--
-- Ràng buộc mới: totalAmount >= 0 (thực lĩnh âm vẫn bị BE từ chối ở tầng nghiệp vụ).
BEGIN;

ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payout_amounts_valid;
ALTER TABLE payouts ADD CONSTRAINT payout_amounts_valid CHECK ("totalAmount" >= 0 AND "beneficiaryCount" > 0);

COMMIT;
