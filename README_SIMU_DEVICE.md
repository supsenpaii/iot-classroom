# Hướng dẫn nhánh simu_device — mô phỏng ESP32

Nhánh này bổ sung chương trình độc lập trong `esp32-simulator/` lên nền code web `main`. Có thể tải và chạy riêng thư mục đó; không cần chạy backend hoặc đăng nhập giáo viên trên máy simulator. Web giáo viên chạy ở một máy khác hoặc cùng máy, miễn URL truy cập được.

## Tải về và chạy

Cần Node.js 24.21.0 và npm:

```bash
git clone --branch simu_device https://github.com/supsenpaii/iot-classroom.git iot-classroom-simu
cd iot-classroom-simu/esp32-simulator
npm ci
npm start
```

Mở **http://localhost:3210**. Không cần `npm ci` ở root nếu chỉ chạy simulator. Dừng bằng Ctrl+C. Lần mở lại dùng Device ID/secret đã lưu để tự reconnect. Trên máy có nvm, chạy `nvm install 24.21.0` và `nvm use 24.21.0` trước.

## Demo từ kết nối đến báo cáo

1. Trên web giáo viên, đăng nhập, tạo lớp/học sinh và bộ đề, tạo phòng; có thể dùng dữ liệu demo 10 câu theo [README_ROOM_ID.md](README_ROOM_ID.md).
2. Trong phòng, chọn tự ghép học sinh rồi **Mở nhận thiết bị**. Lấy ROOM ID 8 chữ số đang còn hạn.
3. Trong simulator, nhập URL web thực tế (origin, ví dụ `https://your-classroom.ts.net` hoặc `http://localhost:3000` nếu cùng máy). Không thêm `/ws`; localhost trên máy khác không trỏ tới máy giáo viên.
4. Đặt tên `ESP32-01`, **Thêm thiết bị**, nhập ROOM ID rồi **Vào phòng**. Thiết bị tự tạo secret, join và mở WebSocket, không cần tài khoản giáo viên/duyệt thủ công.
5. Trên web tên học sinh hiện ngay nếu còn chỗ và bật tự ghép. Kiểm tra đúng học sinh, sửa ghép khi cần. Bấm A/B/C/D lúc chờ để kiểm tra nút.
6. Thêm các profile khác để mô phỏng nhiều học sinh, tối đa 50. Mỗi profile là một thiết bị độc lập.
7. Giáo viên mở màn chiếu và **Bắt đầu**; chọn từng thiết bị, bấm A/B/C/D. Simulator hiện lựa chọn được backend lưu sau ACK.
8. Thử tạm dừng/tiếp tục hoặc mất mạng; kết thúc bài và xem biểu đồ/xuất Excel trên web.

Web có thể giữ `ENABLE_SIMULATOR=false`: chương trình này dùng API và header như thiết bị native, không dùng simulator ticket của trình duyệt. Máy host web phải bật và online; máy simulator không cần chung Wi-Fi nếu web đã được công khai qua HTTPS.

## Chức năng thiết bị và thử lỗi

- Kiểm tra: A/B/C/D; khi chờ/tạm dừng gửi thử nút, không chấm điểm.
- Flashcard: A/OK = Nhớ, B/DEL = Chưa nhớ; khảo sát A–D; điểm danh phím bất kỳ theo hoạt động web đã mở.
- Bàn phím: chọn thẻ rồi focus vùng trống; A–D/1–4, Enter = OK, Backspace = DEL. Không bắt phím khi đang nhập mã/focus nút.
- **Ngắt mạng/Nối lại mạng**: nhận snapshot mới sau reconnect; không gửi đáp án mới khi offline.
- **Khởi động lại**: giữ credentials và gói chờ ACK; không reset đồng hồ server.
- **Mất ACK một lần**: retry nguyên gói; **Gửi lại gói cuối** kiểm tra chống ghi trùng.
- **Thông tin & nhật ký**: xem Device ID, kết nối, gói chờ và ACK, không hiển thị secret.
- **Xóa thiết bị mô phỏng** chỉ xóa profile local. Muốn vô hiệu thiết bị phải thu hồi trên web; muốn chuyển phòng cũ chưa kết thúc phải gỡ khỏi phòng cũ.

Backend quyết định deadline. Không gửi đáp án đúng/tên học sinh tới thiết bị; danh tính học sinh kiểm tra trên web giáo viên. Đây là mô phỏng giao thức/nút bấm, chưa kiểm thử GPIO, Wi-Fi vật lý hay firmware ESP32 thật.

## Dữ liệu, cấu hình và cập nhật

Credentials lưu tại `~/.iot-esp32-simulator/devices.json` (0600 trên Unix), thư mục 0700. Không chia sẻ hoặc commit file này. Không dùng localStorage làm nơi lưu credentials. Không chạy hai process dùng cùng thư mục dữ liệu.

Các biến tùy chọn, ví dụ bash:

```bash
SIMULATOR_PORT=3211 npm start
CLASSROOM_URL=https://your-classroom.ts.net npm start
SIMULATOR_DATA_DIR=/path/to/private/device-data npm start
```

Server điều khiển chỉ lắng nghe `127.0.0.1`; HTTPS/WSS xác minh TLS mặc định. Sai/hết hạn ROOM ID thì mở nhận mới trên web. Không thay URL của profile đã đăng ký; tạo profile mới nếu thử server khác.

Dừng simulator trước khi cập nhật, tại thư mục clone chạy:

```bash
git pull --ff-only origin simu_device
cd esp32-simulator
npm ci
npm start
```

## Kiểm thử và tài liệu đầy đủ

Tại `esp32-simulator/` chạy `npm test`: kiểm tra lưu cấu hình, quyền local, retry, queue, restart, reconnect và các chế độ. Để chạy tích hợp backend/SQLite thật ở database tạm, từ root repository:

```bash
npm ci
npm run test:device-simulator
```

Xem [README của simulator](esp32-simulator/README.md) và [giao thức ESP32](docs/PROTOCOL.md). Khi chỉ cần web, tải nhánh `main`; khi cần chương trình thiết bị độc lập, dùng thư mục `esp32-simulator` ở nhánh này. Thực tế kiểm thử trên Linux/Chromium.
