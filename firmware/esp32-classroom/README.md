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

## Tiết kiệm pin

- Bật Wi-Fi modem sleep (`WiFi.setSleep(true)`) để giảm tiêu thụ điện giữa các lần truyền dữ liệu.
- OLED tự tắt sau 60 giây không thao tác ở màn chờ. Nhấn phím hoặc đổi trạng thái phiên học sẽ bật lại màn hình; phím vẫn được xử lý bình thường.
- OLED luôn sáng khi đang làm bài, mất Wi-Fi hoặc chờ xác nhận đáp án. Chỉ truyền lại khung hình khi nội dung thay đổi.
- Duy trì WebSocket và heartbeat 4 giây để nhận câu hỏi và đồng bộ trạng thái. Chưa bật light sleep/deep sleep cho CPU.

Chưa đo mức tiêu thụ thực tế hoặc kiểm thử độ trễ WebSocket với modem sleep trên phần cứng. Tiết kiệm điện không thay thế nguồn cấp ổn định khi Wi-Fi phát sóng.

## Nhập ROOM ID rồi MSSV

Firmware vẫn dùng DEVICE_ID/DEVICE_SECRET đã đăng ký trong `include/device_config.h`.
Cần cấu hình Wi-Fi, WS_HOST và WS_PORT trỏ đến backend; chưa tự cấp credentials.

1. Giáo viên thêm đúng MSSV vào lớp trước khi tạo phòng, rồi mở nhận thiết bị.
2. OLED hiện `ROOM ID + ENTER`: nhập 8 số ROOM ID, nhấn ENTER.
3. OLED hiện `STUDENT ID + ENTER`: nhập MSSV (1–10 chữ số, giữ số 0 đầu), nhấn ENTER để gửi cả mã phòng và MSSV.
4. Khi hiện `JOINED / WAITING`, chờ snapshot `READY / WAITING` và giáo viên bắt đầu.
5. Dùng A/B/C/D trả lời; màn hình kết thúc hiển thị kết quả từ backend.

DELETE xóa một số; khi ô MSSV trống, DELETE quay lại sửa ROOM ID.
MSSV được dùng để ghép đúng học sinh trong snapshot phiên. Backend không dùng tên thiết bị làm MSSV và không ghép theo thứ tự kết nối. ID/secret và nhãn quản lý của thiết bị đã đăng ký được giữ nguyên khi join.
Bước nhập MSSV không còn gửi lệnh đổi tên thiết bị riêng.
`STUDENT NOT IN ROOM`: MSSV không có trong danh sách buổi thi hoặc đã đánh dấu vắng.
`STUDENT IN USE`: học sinh/thiết bị đã ghép khác; giáo viên cần sửa ghép.
`ROOM INVALID/EXPIRED`: nhập lại mã mới sau khi giáo viên mở nhận.

Nếu mất phản hồi, đợi 60 giây rồi nhấn ENTER để gửi lại nguyên yêu cầu.
Yêu cầu được lưu trong NVS trước khi gửi; khởi động lại vẫn có thể ENTER để thử lại.
Trong thời gian chưa rõ kết quả, không sửa nội dung yêu cầu để tránh ghép trùng.
Kết nối WebSocket lấy lại snapshot sau khi join thành công.
Trong RUNNING/PAUSED chỉ xử lý A/B/C/D; ENTER ở màn kết quả mở lại ô nhập ROOM ID.

Cùng ESP32 có thể join phiên mới với MSSV khác sau khi phiên trước kết thúc/hủy, dùng ID/secret cũ và request ID mới. Trong phiên hiện tại, học sinh không tự chiếm binding khác; giáo viên sửa ghép trong LOBBY/PAUSED. Khi binding thay đổi, snapshot có binding ID mới và firmware xóa pending answer cũ, lấy lại seq từ current_answer. Không thay GPIO, OLED hoặc packet v1 trong bản cập nhật backend pairing này.

NVS chỉ lưu yêu cầu join đang chờ, không lưu trạng thái join đã thành công. Reconnect lúc đang chạy được hỗ trợ; tự khôi phục sau reboot thành công vẫn cần kiểm thử/cải thiện riêng. Cần thử trên ESP32 thật: dùng hai MSSV ở hai phiên, đổi binding khi tạm dừng, retry sau mất phản hồi, mất Wi-Fi và reboot. Mapping điểm danh không tự đổi theo MSSV vừa dùng trong quiz.

Cập nhật và khởi động lại backend, sau đó nạp firmware:

```bash
npm run build
# Khởi động lại tiến trình backend đang chạy.
pio run -d firmware/esp32-classroom -t upload
```

Kiểm thử backend: `node scripts/test-student-room-pairing.mjs` và
`node scripts/test-room-pairing.mjs` sau khi build.
Chưa kiểm thử thao tác bàn phím/OLED trên phần cứng thật.
