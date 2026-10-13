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
- OLED tự tắt sau 60 giây ở màn nhập ban đầu, 20 giây ở màn chờ, 30 giây ở màn kết thúc/kết quả. Thời gian tính từ lúc vào trạng thái hoặc lần tương tác gần nhất. Snapshot giống nhau không kéo dài thời gian sáng của màn kết quả; kết quả mới/cập nhật được hiển thị lại đủ 30 giây.
- Phím đầu tiên khi OLED tắt chỉ đánh thức màn hình: không nhập/xóa ký tự, gửi đáp án, thử nút, retry join hoặc bỏ kết quả. Lần nhấn tiếp theo giữ chức năng hiện có; ENTER ở màn kết quả đang sáng vẫn mở nhập ROOM ID. Tắt OLED không xóa trạng thái phiên, kết quả, binding hoặc packet đang chờ ACK.
- OLED luôn sáng trong RUNNING và PAUSED, kể cả mất kết nối. Giáo viên bắt đầu bài sẽ tự đánh thức OLED. Ngoài lúc thi, mất Wi-Fi không giữ màn hình sáng vô hạn; thay đổi kết nối thực sự đánh thức màn hình, còn sự kiện đóng socket lặp lại không kéo dài thời gian chờ.
- Dùng dirty flag cho sự kiện thay đổi và chỉ dựng lại màn hình khi cần. Đếm ngược cập nhật khi số giây hiển thị đổi; thông báo Wi-Fi 3 giây và thông báo nhập liệu 5 giây vẫn hết hạn đúng thời điểm. Chỉ truyền khung hình qua I²C khi buffer thay đổi.
- Duy trì WebSocket và heartbeat 4 giây để nhận câu hỏi và đồng bộ trạng thái. Chưa bật light sleep/deep sleep cho CPU.

Chưa đo mức tiêu thụ thực tế hoặc kiểm thử độ trễ WebSocket với modem sleep trên phần cứng. Tiết kiệm điện không thay thế nguồn cấp ổn định khi Wi-Fi phát sóng.

Không thay chữ, ngôn ngữ, font, kích thước OLED hoặc vị trí các dòng. Tên Wi-Fi dài
vẫn xuống dòng trong thông báo Connected 3 giây như trước; các dòng khác giữ nguyên
quy tắc không xuống dòng và giới hạn vùng vẽ của thư viện, không thêm thao tác cắt chuỗi.

Kiểm thử tối ưu OLED trên máy phát triển:

```bash
pio run -d firmware/esp32-classroom
node scripts/test-oled-display.mjs
```

Script cần C++ compiler (`g++`, hoặc biến `CXX`) và ArduinoJson đã tải bởi PlatformIO.
Nó biên dịch các hàm firmware thực tế với I/O giả lập, kiểm tra 32 kịch bản về ngủ/
đánh thức, kết quả, chuyển phiên, ACK/queue, redraw, timeout và rollover `millis()`.
Đối chiếu baseline bảo vệ nguyên bộ lệnh vẽ/chữ/font/layout và những hàm mạng/
đếm ngược không thuộc thay đổi phục hồi. ACK/retry và lưu pending answer được kiểm tra
riêng bằng `scripts/test-firmware-recovery.mjs`. Các kiểm thử không nạp board, mở Serial hoặc sử dụng credentials/database thật.
Vẫn cần kiểm tra OLED, phím và dòng điện trên ESP32 thật trước khi kết luận mức tiết kiệm.

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

## Phục hồi sau reboot — Phase 1

Firmware tự kết nối WebSocket bằng ID/secret sau khi Wi-Fi sẵn sàng, kể cả khi RAM
không còn ROOM ID/MSSV. Snapshot từ server xác nhận binding, phiên, câu hỏi, deadline,
sequence và kết quả; không tạo binding mới hay tự gửi lại HTTP join. Nếu binding còn
hợp lệ, không cần nhập lại mã phòng/MSSV. Thiết bị chưa được ghép vẫn dùng quy trình
nhập ROOM ID/MSSV hiện có. Mapping điểm danh không tự đổi theo MSSV vừa dùng trong quiz.

NVS không lưu binding hoặc deadline để làm căn cứ cấp quyền. Namespace `room-pairing`
giữ nguyên khóa `pending` của yêu cầu join; khóa mới `answer` chỉ chứa packet đáp án
nguyên bản và device ID để kiểm tra nguồn. Packet được lưu thành công trước lần gửi
đầu tiên. Retry giữ nguyên request ID, sequence và toàn bộ payload; không ghi NVS mỗi
lần retry. Khi reboot hoặc mất mạng, phải nhận snapshot mới và đối chiếu đúng session,
binding, câu hỏi, sequence trước khi retry. Packet sai danh tính/câu hỏi hoặc bị đáp án
mới hơn thay thế sẽ bị vô hiệu hóa. PAUSED giữ packet chờ resume; FINISHED chỉ cho
server xác nhận packet cũ, không tạo đáp án mới. Backend tiếp tục quyết định deadline
và chống duplicate.

ACK tương ứng kết thúc pending và xóa riêng khóa `answer`, không xóa namespace/NVS
hay credentials. Nếu không lưu được packet, không gửi đáp án chưa được lưu và dùng
thông báo OLED có sẵn `SERVER ERROR`. Packet chưa được lưu bởi phiên bản firmware cũ
không thể lấy lại sau reboot; đáp án đã được server nhận vẫn khôi phục qua snapshot.

Kiểm thử trên máy phát triển, sau khi backend đã build:

```bash
node scripts/test-firmware-recovery.mjs
node scripts/test-oled-display.mjs
pio run -d firmware/esp32-classroom
```

Test phục hồi gồm 44 kịch bản chạy các hàm firmware thực tế với I/O giả lập và 12
kịch bản WebSocket xác thực thật trên SQLite `:memory:`. Không đọc `.env`, không nạp
board, không mở Serial và không tác động database thật. Cần kiểm thử reboot/mất điện,
NVS, bàn phím/OLED và latency trên ESP32 thật. Xem [báo cáo Phase 1](REBOOT_RECOVERY.md).
Phase này chưa triển khai power management mới, button wakeup, adaptive heartbeat hoặc OTA.

Cập nhật và khởi động lại backend, sau đó nạp firmware:

```bash
npm run build
# Khởi động lại tiến trình backend đang chạy.
pio run -d firmware/esp32-classroom -t upload
```

Kiểm thử backend: `node scripts/test-student-room-pairing.mjs` và
`node scripts/test-room-pairing.mjs` sau khi build.
Chưa kiểm thử thao tác bàn phím/OLED trên phần cứng thật.
