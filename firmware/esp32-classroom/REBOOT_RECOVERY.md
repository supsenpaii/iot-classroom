# SmartClass — nghiệm thu Phase 1: Reboot Recovery

Phạm vi lượt này chỉ gồm tự kết nối lại sau reboot và bảo toàn pending answer.
Không triển khai OTA, sleep mới, interrupt wakeup hoặc adaptive heartbeat.
Các kết quả dưới đây là kiểm thử trên máy phát triển; chưa nạp board.

## A. Nguyên nhân đã xác minh

Sau khi join thành công, firmware cũ không lưu ROOM ID/MSSV hay binding đã được xác
nhận. Reboot làm mất `studentCode`, `joinPayload` và `webSocketClientStarted` trong
RAM. `shouldKeepNetworkAlive()` vì thế trả về false, ngăn kết nối WebSocket mặc dù
credentials và binding trên server vẫn hợp lệ. Pending answer cũng chỉ nằm trong RAM.
Regression đầu tiên thất bại ở điều kiện kết nối sau boot trên source trước khi sửa.

## B. Kiến trúc và khảo sát hiện trạng

Server tiếp tục là nguồn xác nhận quyền trả lời. Boot chỉ cần credentials hiện có
để nhận snapshot; NVS không được dùng để khẳng định binding, phiên hay deadline.

| Thành phần | Bằng chứng từ source/build hiện tại |
| --- | --- |
| Board cấu hình | `esp32-c3-devkitm-1`, ESP32-C3, CPU 160 MHz; chưa xác minh chip vật lý |
| Flash/RAM cấu hình | Flash 4 MiB, RAM 327.680 byte; chưa truy vấn flash thật |
| Keypad | Ma trận 4×4; hàng GPIO 9/10/20/21, cột 8/7/6/5; không đổi wiring |
| Quét/debounce | Kéo từng hàng LOW, chờ 5 µs; cạnh phím ổn định 40 ms |
| OLED | SSD1306 128×32, I²C SDA 0/SCL 1, địa chỉ 0x3c hoặc 0x3d |
| Thư viện đã build | ArduinoJson 7.4.3, ArduinoWebsockets 0.5.4, Adafruit SSD1306 2.5.17 |
| Reconnect | Wi-Fi thử lại sau 10 giây; WebSocket thử lại sau 2 giây |
| ACK/heartbeat | Retry 1.200 ms; application heartbeat 4 giây, giữ nguyên |
| Backend liveness | Ping 5 giây, kiểm tra timeout 15 giây; chưa đổi heartbeat |
| Blocking hiện có | Boot Wi-Fi chờ tối đa 20 giây; HTTP connect 3 giây/read 5 giây; WebSocket connect/read đồng bộ |

Partition giải mã từ `partitions.bin` của build hiện tại, không chỉnh sửa:

| Partition | Offset | Dung lượng |
| --- | --- | --- |
| nvs | 0x9000 | 20 KiB |
| otadata | 0xe000 | 8 KiB |
| app0 / ota_0 | 0x10000 | 1.280 KiB |
| app1 / ota_1 | 0x150000 | 1.280 KiB |
| spiffs | 0x290000 | 1.408 KiB |
| coredump | 0x3f0000 | 64 KiB |

Có hai OTA app slot trong cấu hình build, nhưng chưa có triển khai/kiểm chứng OTA
hoặc rollback ở Phase 1. Không thay bootloader hoặc partition table.

WebSocket dùng Bearer device secret, `X-Device-Id` và Origin hiện có. Backend xác
thực secret hash và trạng thái revoked. Binding vẫn do `session_devices` quản lý;
receipt `(binding_id, request_id)` bảo vệ request identity và ACK idempotent. Backend
giữ nguyên kiểm tra sequence/deadline, transaction và chấm điểm. Server restart đưa
quiz RUNNING về PAUSED; firmware phải chờ resume theo snapshot.

## C. File thay đổi trong Phase 1

- `firmware/esp32-classroom/src/main.cpp`: boot recovery và pending answer bền vững.
- `scripts/test-firmware-recovery.mjs`: native firmware + backend WebSocket tests mới.
- `scripts/fixtures/firmware-recovery.cpp`: 44 tình huống native mới.
- `scripts/fixtures/oled-display.cpp`: mở rộng I/O mock Preferences/WebSocket phục vụ recovery.
- `scripts/test-oled-display.mjs`: thêm helper phục hồi để biên dịch source thực tế;
  giữ golden renderer và 32 kiểm thử, bảo vệ những hàm mạng không thay đổi bằng baseline
  trước Phase 1; ACK/retry được kiểm tra trực tiếp trong bộ recovery.
- `firmware/esp32-classroom/README.md` và tài liệu này: cập nhật hướng dẫn/giới hạn.

Đối chiếu hash với bản đầu lượt bảo vệ các file ngoài phạm vi, gồm frontend, backend,
shared, BUG 01–04, clipboard, `oled_power.h`, `.vscode`, `platformio.ini`, `.env` và
firmware config. Git còn các thay đổi chưa commit từ trước; không coi toàn bộ diff
so với HEAD là thay đổi của Phase 1.

## D. Logic sau thay đổi

1. Boot mở namespace `room-pairing`, đọc pending join theo cách cũ và pending answer
   mới như một ứng viên chưa được cấp quyền. Khởi tạo OLED/keypad, kết nối Wi-Fi,
   sau đó tự xác thực WebSocket ngay cả khi không có ROOM ID/MSSV trong RAM.
2. Snapshot mới xác nhận binding, phiên, câu hỏi, trạng thái, countdown, đáp án và
   kết quả. Có binding hợp lệ thì bỏ yêu cầu nhập lại ROOM ID/MSSV; không tự HTTP join.
3. Đáp án mới được lưu ở riêng khóa `answer` trước lần gửi đầu. Record phiên bản 1
   chứa device ID và chuỗi packet nguyên bản, không thêm secret. Giới hạn record
   1.024 byte; kiểm tra kiểu dữ liệu, field, ID, choice và seq 1..2.147.483.647.
4. Sau reboot/reconnect, chỉ retry khi có snapshot mới khớp session/binding/question,
   mode quiz, RUNNING/PAUSED/FINISHED và không mâu thuẫn sequence/choice của server.
   Giữ nguyên bytes, request ID và sequence; không tự gán packet vào học sinh khác.
5. PAUSED giữ packet chờ resume để tránh lưu receipt từ chối vĩnh viễn do pause.
   Packet cùng câu hỏi đã đóng hoặc FINISHED chỉ gửi để server quyết định receipt/
   rejection; không sinh đáp án mới. Nếu câu hỏi đã chuyển, hủy packet cũ an toàn.
6. Mất Wi-Fi/WebSocket vô hiệu hóa snapshot và quyền gửi cũ. Rebind, chuyển phiên,
   snapshot unassigned hoặc đáp án mới hơn vô hiệu hóa pending không còn hợp lệ.
7. ACK đúng request sau snapshot hợp lệ kết thúc pending và xóa riêng khóa `answer`.
   Hàng đợi lựa chọn mới nhất trong RAM vẫn xử lý sau ACK theo luồng hiện có; lựa chọn
   chưa gửi trong hàng đợi không được phục hồi qua reboot/disconnect.
8. Không ghi NVS mỗi lần retry/heartbeat. Lỗi lưu NVS: không gửi packet chưa được lưu,
   hiển thị thông báo có sẵn `SERVER ERROR`. Lỗi xóa record: log chung, không chứa
   credentials; lần boot sau vẫn phải qua snapshot/dedup của server.

## E. Regression tests

- RED trước sửa: tái hiện boot không giữ kết nối mạng dù credentials hợp lệ.
- 44/44 native cases PASS: boot states, durable-before-send, identity/payload/sequence,
  mất ACK, pause/resume, packet cũ, disconnect, NVS hỏng/khác thiết bị/quá lớn và lỗi
  ghi/xóa. Biên dịch các hàm firmware thực tế với ArduinoJson, giả lập phần I/O.
- 12/12 WebSocket cases PASS: xác thực thật, SQLite `:memory:`, khôi phục binding/
  deadline/result, duplicate ACK, stale sequence, server restart, rebind, phiên mới,
  credentials sai và device revoked. Không tạo binding/answer/join ngoài dự kiến.
- OLED 32/32 PASS; golden hash toàn bộ lệnh vẽ/chữ/font/layout không đổi.

## F. Firmware build

`pio run -d firmware/esp32-classroom`: PASS. Không chạy upload, monitor hay OTA.

## G. Backend/frontend verification

Chạy tại bản sao workspace độc lập, không sao chép `.env` hoặc database thật:

- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- 18/18 `scripts/test-*.mjs`: PASS.
- BUG 01: 29/29; BUG 02: 27/27; BUG 03: 30/30; BUG 04: 57 backend/schema/import
  và 18 browser cases đều PASS.
- `git diff --check`: PASS; kiểm tra whitespace của file mới riêng.

Không tuyên bố đã chạy lại bài tải 50 WebSocket clients trong lượt này.

## H. Memory/flash

Build báo static RAM 41.356/327.680 byte (12,6%), flash 985.824/1.310.720 byte (75,2%).
So với build đầu Phase 1: tăng 24 byte static RAM và 6.604 byte flash. Đây không phải
heap usage. Chưa đo free/minimum heap, stack peak hoặc phân mảnh trên ESP32 thật.
JSON/String và I/O có cấp phát động; bộ đọc NVS có buffer stack 1.025 byte.

## I. Compatibility

Không đổi API, packet WebSocket v1, SQLite schema, pairing, MSSV, scoring, deadline,
GPIO hoặc cấu hình. Không đổi chữ/font/layout hay chính sách tắt/bật OLED đã có.
Khác biệt có chủ đích: boot tự xác thực, gửi answer cần lưu NVS thành công, và retry
trong PAUSED đợi resume. Firmware cũ không lưu packet nên không thể cứu đáp án chưa
được server nhận trước khi nâng cấp; đáp án đã nhận vẫn khôi phục từ snapshot.

## J. Rủi ro còn lại

- NVS ghi/xóa đồng bộ có thể tăng độ trễ, cần đo trong thời gian thi thực tế; số lần
  ghi tăng theo số đáp án mới/chuyển lựa chọn, không tăng theo retry.
- Không thể phục hồi packet khi server không còn xác nhận đúng câu hỏi/binding;
  ưu tiên không ghi sai học sinh hoặc lịch sử. Backend tiếp tục quyết định deadline.
- HTTP/WS chưa có TLS đầy đủ. File example được Git theo dõi đang chứa giá trị cấu
  hình cụ thể thay vì toàn bộ placeholder; chưa xác minh chúng có đang dùng thật.
  Không in các giá trị, không sửa/đổi credentials trong Phase 1; cần xử lý riêng.

## K. Chưa kiểm chứng

Reboot/mất điện thật, tính bền NVS khi cắt nguồn giữa ghi/xóa, flash wear, heap/stack
runtime, OLED/keypad vật lý, độ trễ ACK và mạng gián đoạn kéo dài. Mock không thay
thế kiểm thử board. Chưa kiểm thử OTA, rollback, deep/light sleep hoặc wakeup GPIO.
Không reset/xóa NVS thiết bị, migration/reset SQLite thật, upload, commit hoặc push.

## L. Đề xuất tiếp theo

Nghiệm thu recovery trên ESP32 thật với LOBBY/RUNNING/PAUSED/FINISHED, mất Wi-Fi,
mất ACK và rebind. Sau khi được xác nhận mới thực hiện Phase 2 Power Management
State Machine; giữ ưu tiên correctness/reliability trước tiết kiệm điện. OTA thuộc
Phase 6 và chưa được triển khai trong lượt này.
