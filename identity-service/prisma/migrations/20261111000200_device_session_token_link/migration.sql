-- Gắn refresh token với phiên thiết bị để thu hồi thật khi gỡ thiết bị / đổi mật khẩu.
ALTER TABLE "refresh_tokens" ADD COLUMN "deviceSessionId" TEXT;
CREATE INDEX "refresh_tokens_deviceSessionId_idx" ON "refresh_tokens"("deviceSessionId");

-- Dọn toàn bộ phiên thiết bị cũ: chúng là seed giả (dev-01/02/03) hoặc bản ghi
-- đoán từ User-Agent, không gắn với token nào nên không thể thu hồi.
-- Phiên thật sẽ được tạo lại từ lần đăng nhập kế tiếp với thông tin thiết bị thật.
DELETE FROM "device_sessions";