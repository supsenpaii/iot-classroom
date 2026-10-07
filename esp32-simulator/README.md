# Chương trình mô phỏng thiết bị ESP32 độc lập

Giao diện riêng tại **http://localhost:3210**, kết nối tới web giáo viên bằng HTTPS/WSS và header xác thực như firmware ESP32. Không nằm trong link web giáo viên, không cần tài khoản giáo viên, không dùng simulator ticket và hoạt động cả khi `ENABLE_SIMULATOR=false` trên web.

## Chạy

Cần Node.js **24.21.0** và npm. Có thể copy riêng cả thư mục `esp32-simulator` sang máy khác; không cần source/backend/database của web để chạy chương trình.

```bash
cd iot-classroom-simu/esp32-simulator
npm ci
npm start
```

Mở **http://localhost:3210**. Nếu dùng nvm trên máy này, chạy `nvm use 24.21.0` trước. Ctrl+C dừng chương trình; lần mở lại tự nối các thiết bị đã đăng ký bằng credentials đã lưu.

## Demo với web mới

1. Mở web giáo viên, đăng nhập, chuẩn bị lớp/học sinh và đề, tạo buổi kiểm tra.
2. Trong phòng kiểm tra nhấn **Mở nhận thiết bị**, lấy ROOM ID 8 chữ số.
3. Ở chương trình riêng, nhập URL web (mặc định link Tailscale hiện tại), đặt tên `ESP32-01`, nhấn **Thêm thiết bị**.
4. Trong thẻ thiết bị, nhập ROOM ID và nhấn **Vào phòng**. Đúng mã là tự vào; không cần duyệt. Chương trình tự tạo và lưu secret, không yêu cầu nhập secret.
5. Web mặc định tự ghép vào học sinh chưa có thiết bị theo thứ tự mã, tên hiện ngay trong **Học sinh đã kết nối**. Kiểm tra đúng tên; sửa ghép trong quản lý thiết bị nếu cần. Nếu giáo viên tắt tự ghép hoặc hết học sinh trống thì chọn học sinh thủ công. Bấm A/B/C/D để thử. Có thể thêm nhiều thiết bị, tối đa 50 thẻ.
6. Mở màn chiếu và bắt đầu bài. Bấm A/B/C/D để trả lời câu chung đang chiếu. Đèn xác nhận chỉ bật sau ACK; màn hình nhỏ hiện lựa chọn được server lưu, trạng thái câu và đồng hồ theo thời gian server.
7. Kết thúc bài, xem báo cáo và xuất Excel trên web giáo viên.

Máy chạy simulator chỉ cần truy cập được URL web qua Internet nếu dùng Tailscale Funnel, không phải cùng Wi-Fi hay đăng nhập Tailscale. Máy đang host web vẫn phải bật và online.

## Phím và chế độ

| Hoạt động trên web | Phím thiết bị |
| --- | --- |
| Phòng chờ/tạm dừng | A/B/C/D gửi `button.test`; không chấm điểm. |
| Kiểm tra, câu đang mở | A/B/C/D gửi đáp án; backend quyết định hợp lệ và deadline. |
| Flashcard | A hoặc OK = Nhớ; B hoặc DEL = Chưa nhớ. |
| Khảo sát | A–D theo số lựa chọn được mở. |
| Điểm danh | Phím bất kỳ; phải gán thiết bị mặc định cho học sinh ở trang lớp trước. |

Click thẻ để chọn thiết bị, click vùng trống của thẻ rồi dùng bàn phím **A–D / 1–4**, **Enter = OK**, **Backspace = DEL**. Khi đang nhập mã hoặc focus nút, phím phục vụ nhập liệu/thao tác nút. Không hiển thị tên học sinh hoặc đáp án đúng vì giao thức thiết bị không được nhận các dữ liệu này.

## Thử sự cố

- **Ngắt mạng / Nối lại mạng:** mất kết nối, giữ cấu hình, tự lấy snapshot mới khi nối lại. Không gửi đáp án mới khi offline.
- **Khởi động lại:** mô phỏng restart thiết bị; giữ Device ID/secret và gói đang chờ ACK, không đặt lại bài hoặc đồng hồ server.
- **Mất ACK một lần:** bỏ một ACK ứng dụng rồi retry nguyên gói. Áp dụng cho kiểm tra/flashcard/khảo sát/điểm danh; không phải mất WebSocket pong.
- **Gửi lại gói cuối:** gửi nguyên request ID, sequence và nội dung để kiểm tra backend không ghi trùng.
- Bấm nhanh nhiều lựa chọn: chỉ một gói chờ ACK; giữ lựa chọn mới nhất cùng câu/thẻ. Không chuyển lựa chọn đang chờ sang câu mới.
- **Thông tin & nhật ký:** Device ID, URL, gói chờ và lịch sử ACK/kết nối. Không hiển thị secret.
- **Xóa thiết bị mô phỏng:** chỉ xóa cấu hình trên máy. Để ngừng quyền thiết bị trên server, gỡ khỏi phòng/thu hồi trong web. Thêm thiết bị mới sẽ có danh tính mới.

Sai mã/hết hạn/đóng nhận: mở nhận hoặc tạo mã mới trên web rồi nhập lại. Đã vào một phòng chưa kết thúc thì phải gỡ khỏi phòng đó trước khi vào buổi khác. Thiết bị thuộc giáo viên khác cần tạo profile mới; chương trình không tự chuyển quyền sở hữu. Nếu mất phản hồi join, bấm lại cùng mã để dùng lại request đã lưu.

## Cấu hình và dữ liệu

Credentials được lưu trong `~/.iot-esp32-simulator/devices.json`, quyền file `0600` trên hệ thống hỗ trợ quyền Unix. Không dùng localStorage hoặc database web làm nơi lưu credentials của thiết bị. Không gửi file này lên Git hay chia sẻ. Folder có thể chạy riêng trên Windows/macOS/Linux với Node 24; thực tế kiểm thử hiện tại trên Linux/Chromium.

Biến tùy chọn (ví dụ cho bash):

```bash
SIMULATOR_PORT=3211 npm start
CLASSROOM_URL=https://your-classroom.ts.net npm start
SIMULATOR_DATA_DIR=/path/to/private/simulator-data npm start
```

URL phải là origin HTTP/HTTPS, không chứa `/ws`, đường dẫn hoặc secret. Production dùng HTTPS/WSS và xác minh TLS mặc định; không tắt kiểm tra chứng chỉ. HTTP chỉ để demo development trong mạng kiểm soát. URL server đã đăng ký được giữ theo từng profile; muốn thử server khác hãy thêm profile mới. Mỗi thư mục dữ liệu chỉ chạy một chương trình tại một thời điểm. Server điều khiển chỉ bind `127.0.0.1`, không mở ra Internet/LAN.

## Kiểm thử

```bash
npm test
```

Kiểm tra độc lập bằng backend giao thức giả trong test: header native, retry/ACK, queue, pause, reboot, flashcard, khảo sát, điểm danh, deadline, quyền truy cập local và lưu cấu hình. Khi có cả repository web, chạy `npm run test:device-simulator` tại root để kiểm tra tích hợp với backend/database thật ở môi trường test riêng.

Đây là mô phỏng phần mềm giao thức và nút bấm, không phải emulator chip/firmware. Chưa kiểm tra GPIO, debounce, Wi-Fi vật lý, pin, màn hình board hoặc ESP32 thật.
