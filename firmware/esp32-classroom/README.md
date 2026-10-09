# ESP32-C3: bàn phím 4×4 và OLED 128×32

Dựa trên code người dùng cung cấp, giữ nguyên chân keypad và OLED SDA=0/SCL=1.

1. Điền Wi-Fi, DEVICE_ID và DEVICE_SECRET trong `include/device_config.h` (đã có bản mẫu). File này được bỏ qua bởi Git. Khi chia sẻ dự án dùng `device_config.example.h`.
2. Sửa WS_HOST thành IP máy chạy backend. Board mặc định ESP32-C3 DevKitM-1; kiểm tra đúng board thực tế trước khi nạp.
3. Trong thư mục này chạy `pio run`, sau đó `pio run -t upload` và `pio device monitor`.
4. Đăng ký và ghép thiết bị với học sinh trên website, tạo buổi thi và bắt đầu.

OLED dùng chữ không dấu vì font mặc định không hỗ trợ tiếng Việt:
- `ONLINE / UNASSIGNED`: WebSocket đã kết nối và nhận snapshot, chưa ghép buổi thi.
- `READY / WAITING` và `20 cau / 10 s/cau`: đã ghép, chờ giáo viên bắt đầu.
- `QUIZ IN PROGRESS`, `Cau 1/20  10s`: đếm ngược theo snapshot của backend.
- `PAUSED`: giữ thời gian còn lại; tiếp tục khi nhận trạng thái mới.
- `SENDING: A`: đang chờ ACK; `SAVED: A`: server đã xác nhận.
- Mất Wi-Fi/WebSocket: hiện trạng thái mất kết nối, chặn đáp án mới đến khi đồng bộ.

Không gửi mới khi hết giờ; server vẫn là bên quyết định hạn trả lời.
Gửi lại cùng packet nếu mất ACK, đồng thời xóa lựa chọn chờ khi đổi câu hoặc binding.
Giữ sequence tăng trong cùng câu ngay cả khi nhận snapshot khi đang chờ ACK.
Nhận thông báo `device.connected` trên Serial; OLED hiển thị trạng thái kết nối và ghép từ snapshot ngay sau đó.
Firmware tương thích các trường total_questions, seconds_per_question, question_order và countdown_ms của backend mới.
Không tự tạo hoặc sửa tài khoản/secret trên website.

Cấu hình này dùng WS/HTTP cho mạng LAN thử nghiệm. Chưa bổ sung TLS/WSS.
Chưa kiểm thử OLED, bàn phím và kết nối trên phần cứng thực tế.

## Nhập MSSV rồi ROOM ID

Firmware vẫn dùng DEVICE_ID/DEVICE_SECRET đã đăng ký trong `include/device_config.h`.
Cần cấu hình Wi-Fi, WS_HOST và WS_PORT trỏ đến backend; chưa tự cấp credentials.

1. Giáo viên thêm đúng MSSV vào lớp trước khi tạo phòng, rồi mở nhận thiết bị.
2. Nhập MSSV (1–10 chữ số, giữ số 0 đầu), nhấn ENTER.
3. OLED hiện `ROOM ID + ENTER`: nhập 8 số ROOM ID, nhấn ENTER.
4. Khi hiện `JOINED / WAITING`, chờ snapshot `READY / WAITING` và giáo viên bắt đầu.
5. Dùng A/B/C/D trả lời; màn hình kết thúc hiển thị kết quả từ backend.

DELETE xóa một số; khi ô ROOM ID trống, DELETE quay lại sửa MSSV.
MSSV được dùng để ghép đúng học sinh kể cả khi tắt tự ghép theo thứ tự.
Bước nhập MSSV không còn gửi lệnh đổi tên thiết bị riêng.
`STUDENT NOT IN ROOM`: MSSV không có trong danh sách buổi thi hoặc đã đánh dấu vắng.
`STUDENT IN USE`: học sinh/thiết bị đã ghép khác; giáo viên cần sửa ghép.
`ROOM INVALID/EXPIRED`: nhập lại mã mới sau khi giáo viên mở nhận.

Nếu mất phản hồi, đợi 60 giây rồi nhấn ENTER để gửi lại nguyên yêu cầu.
Yêu cầu được lưu trong NVS trước khi gửi; khởi động lại vẫn có thể ENTER để thử lại.
Trong thời gian chưa rõ kết quả, không sửa nội dung yêu cầu để tránh ghép trùng.
Kết nối WebSocket lấy lại snapshot sau khi join thành công.
Trong RUNNING/PAUSED chỉ xử lý A/B/C/D; ENTER ở màn kết quả mở lại ô nhập MSSV.

Cập nhật và khởi động lại backend, sau đó nạp firmware:

```bash
npm run build
# Khởi động lại tiến trình backend đang chạy.
pio run -d firmware/esp32-classroom -t upload
```

Kiểm thử backend: `node scripts/test-student-room-pairing.mjs` và
`node scripts/test-room-pairing.mjs` sau khi build.
Chưa kiểm thử thao tác bàn phím/OLED trên phần cứng thật.
