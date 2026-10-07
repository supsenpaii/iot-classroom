> **Bạn đang ở nhánh `simu_device`.** Chạy thiết bị độc lập theo [README_SIMU_DEVICE.md](README_SIMU_DEVICE.md). Phần web được phát hành ở nhánh `main`.

# Lớp học tương tác — website kết nối ESP32

Giáo viên chiếu một câu hỏi chung; học sinh bấm A/B/C/D trên thiết bị của mình. Backend nhận đáp án qua WebSocket, trả ACK sau khi lưu SQLite, chấm điểm và xuất Excel.

**Đây là phần mềm website/backend. Chưa kèm firmware ESP32.** Thiết bị cần firmware thực hiện giao thức ở [docs/PROTOCOL.md](docs/PROTOCOL.md); website không trực tiếp đọc chân GPIO. Phần mềm đã được kiểm thử với thiết bị giả lập, chưa nghiệm thu bằng ESP32 thật.

Giao diện hiện dùng tông neon nền xanh đêm. Bảng giáo viên hiển thị thiết bị và màn chiếu đang kết nối, học sinh đã/chưa có đáp án được backend lưu, thời điểm ghi nhận và cảnh báo mất kết nối. Sau khi đóng câu, giáo viên có thể công bố phân bố A/B/C/D lên màn chiếu. Báo cáo có biểu đồ, ma trận học sinh × câu, dấu vết sự cố và xuất Excel/PDF.

## Cài đặt

Cần Node **24.21.0** và npm. Nếu có nvm, chạy `nvm install && nvm use` trong thư mục đã tải về.

```bash
npm ci
npm run build
# Chỉ copy lần đầu; không ghi đè .env đang có:
[ -f .env ] || cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Điền chuỗi ngẫu nhiên vừa tạo vào `SESSION_SECRET` trong `.env`, sau đó:

```bash
npm run db:migrate
npm start
```

Mở **http://localhost:3000/register** để tự tạo tài khoản giáo viên bằng email và mật khẩu ít nhất 12 ký tự. Có thể dùng `npm run teacher:create` để tạo tài khoản qua terminal. Không có tài khoản mặc định hoặc dữ liệu học sinh đi kèm. SQLite lưu ở `data/app.sqlite`; giữ thư mục này khi nâng cấp.

## Sử dụng app từ đầu đến báo cáo

1. Vào `/register` để tạo tài khoản giáo viên, hoặc `/login` nếu đã có tài khoản. Mỗi giáo viên chỉ thấy dữ liệu của mình.
2. Trong **Lớp học**, tạo lớp và thêm học sinh. Trong **Ngân hàng câu hỏi**, tải mẫu XLSX/CSV, nhập câu hỏi, xem trước rồi lưu bộ đề.
3. Trong phòng kiểm tra, nhấn **Mở nhận thiết bị** để lấy **ROOM ID** 8 chữ số, hiệu lực 5 phút. Mặc định tự ghép thiết bị vào học sinh chưa có thiết bị theo thứ tự mã; tên hiện ngay trong **Học sinh đã kết nối**. Kiểm tra tên, sửa ghép trong **Quản lý thiết bị** nếu cần, hoặc bỏ chọn tự ghép trước khi mở nhận để ghép thủ công. Firmware cũ vẫn dùng cấu hình Device ID/secret.
4. Tạo buổi kiểm tra, chọn lớp/bộ đề, số câu và thời gian. Ghép mỗi học sinh với một thiết bị; kiểm tra nút bấm trước khi bắt đầu. Nếu chưa có ESP32, bản development có thể bật `ENABLE_SIMULATOR=true` và dùng trang **Giả lập**.
5. Mở màn hình trình chiếu cho cả lớp. Giáo viên điều khiển buổi kiểm tra ở bảng riêng; học sinh bấm A/B/C/D trên thiết bị. Web hiển thị trạng thái kết nối, đã/chưa nộp, thời gian và kết quả sau khi đóng câu.
6. Vào **Báo cáo** để xem biểu đồ, ma trận kết quả và xuất Excel/PDF. Có thể nhập kết quả cũ bằng XLSX/CSV ngay tại trang này.
7. Vào **Flashcard** để tạo bộ thẻ (nhập tay, XLSX/CSV cột `front`/`back`, hoặc chuyển từ bộ đề có sẵn). **Bắt đầu ôn tập** để chiếu thẻ cho cả lớp: học sinh bấm A = Nhớ, B = Chưa nhớ trên thiết bị, giáo viên thấy ngay số bạn đã nhớ và ôn lại riêng các thẻ chưa nhớ. **Bật link tự học** để học sinh mở `/study/<mã>` trên điện thoại, không cần tài khoản; tiến độ lưu trên máy của học sinh.
8. **Thi đua**: bật khi tạo buổi kiểm tra; công bố kết quả câu để màn chiếu hiện top 5, cuối buổi có bục vinh danh. **Khảo sát nhanh**: hỏi cả lớp một câu, học sinh bấm A–D ẩn danh. **Điểm danh**: gán thiết bị mặc định cho học sinh trong trang lớp, mở điểm danh, học sinh bấm phím bất kỳ; xuất Excel.

Để chạy web trên một máy khác qua Tailscale Funnel, kể cả máy dùng tài khoản Tailscale khác, xem [hướng dẫn chuyển máy](docs/TAILSCALE_MAY_KHAC.md). Chuyển cả database và app; chỉ bật Tailscale trên máy mới không giữ web hoạt động khi máy cũ tắt.

## Kết nối ESP32 trên mạng LAN để thử nghiệm

### Cách mới: ROOM ID tự vào phòng

Backend đã hỗ trợ API ghép nối ROOM ID; **firmware ESP32 hiện chưa được cung cấp trong repository**. Firmware phải triển khai [hợp đồng join](docs/PROTOCOL.md#ghép-nối-tự-động-bằng-room-id) trước khi dùng cách này. Mã không thay thế URL server hoặc cấu hình Wi-Fi.

1. Tạo phòng kiểm tra, nhấn **Mở nhận thiết bị**, lấy mã 8 chữ số.
2. ESP32 có URL server và Wi-Fi, nhập ROOM ID qua trang cấu hình thiết bị. Thiết bị tự tạo/lưu secret 256 bit, gửi HTTPS `POST /api/device-pairing/join`, nhận Device ID và tự mở WebSocket; người dùng không phải nhập secret.
3. Web hiện học sinh đã kết nối ngay nếu bật tự ghép và còn học sinh trống. Kiểm tra đúng người cầm thiết bị; sửa ghép khi cần. Bấm thử A/B/C/D để nhận diện và kiểm tra kết nối.
4. Đóng nhận hoặc bắt đầu bài; thiết bị đã vào vẫn giữ kết nối. Mất mạng tự nối lại bằng cấu hình đã lưu, không cần mã mới.
5. Khi thay thiết bị, tạm dừng bài; có thể mở nhận thêm. **Gỡ khỏi phòng** bỏ ghép hiện tại, giữ thiết bị và lịch sử; **Thu hồi** trong mục Thiết bị vô hiệu thông tin xác thực.

**Demo không cần phần cứng:** ở môi trường development bật `ENABLE_SIMULATOR=true`, khởi động lại app, mở `/simulator` trong tab khác. Nhập ROOM ID và số thiết bị (1–50), nhấn **Kết nối bằng mã**. Quay lại phòng ghép học sinh rồi bấm A/B/C/D trên simulator. Không bật simulator trên production.

**Chương trình ESP32 mô phỏng riêng:** được phát hành ở [nhánh simu_device](https://github.com/supsenpaii/iot-classroom/tree/simu_device), trong thư mục `esp32-simulator`. Tải nhánh đó vào thư mục khác để chạy độc lập, kể cả khi web production tắt simulator. Xem [hướng dẫn simulator](https://github.com/supsenpaii/iot-classroom/blob/simu_device/README_SIMU_DEVICE.md).

**Hướng dẫn chức năng mới:** [ROOM ID, tự ghép học sinh và demo 10 câu](README_ROOM_ID.md).

Mã chỉ hiện trên bảng giáo viên; ai biết mã trong thời gian mở nhận đều có thể vào. Hết 5 phút, bắt đầu/tiếp tục bài, kết thúc hoặc restart server sẽ ngừng nhận mới. Restart vẫn giữ tài khoản, thiết bị, ghép học sinh và đáp án đã lưu.

**Tạo dữ liệu demo tùy chọn:** sau build, dừng app và backup, chạy `npm run demo:create -- email-giao-vien` với đúng `.env` database cần dùng, rồi mở lại app. Lệnh tạo bản mới gồm lớp 10 học sinh, bộ đề Toán 10 câu và phòng chờ 15 giây/câu; không sửa lớp/đề/buổi cũ. Dữ liệu nguồn tách tại `samples/demo-room-id-10-cau.json`, không tự seed khi khởi động production.

### Cách tương thích: đăng ký Device ID/secret

1. Cho máy chạy backend và ESP32 vào mạng có thể truy cập nhau. Xác định IP LAN của máy, ví dụ `192.168.1.10`.
2. Sửa `.env` rồi khởi động lại `npm start`:

   ```dotenv
   NODE_ENV=development
   HOST=0.0.0.0
   PORT=3000
   PUBLIC_ORIGIN=http://192.168.1.10:3000
   ENABLE_SIMULATOR=false
   ```

   Giữ `SESSION_SECRET` đã tạo và các biến database. Thay IP ví dụ bằng IP thật. Trình duyệt giáo viên/máy chiếu mở đúng `PUBLIC_ORIGIN`; không dùng `localhost` khi origin đã đổi sang IP. Cho phép cổng TCP 3000 qua firewall trên mạng thử nghiệm.
3. Trên website, vào **Thiết bị → Đăng ký**, lưu `device_id` và secret được hiện một lần. Không đưa secret lên Git.
4. Nạp cấu hình Wi-Fi, URL `ws://192.168.1.10:3000/ws`, device ID và secret vào firmware. Khi nâng cấp WebSocket, firmware gửi header:

   ```text
   Authorization: Bearer <secret của thiết bị>
   X-Device-Id: <device_id>
   ```

5. Tạo lớp/học sinh, nhập bộ đề XLSX/CSV theo mẫu tải trên web, tạo buổi kiểm tra và ghép thiết bị với đúng học sinh. Gửi `button.test` để kiểm tra ghép.
6. Giáo viên mở màn hình chiếu và bắt đầu. Firmware lấy `session_id`, `binding_id`, ID câu từ snapshot, rồi gửi lựa chọn A/B/C/D. Chỉ báo đã nhận sau ACK thành công.

Không dùng `localhost` làm địa chỉ server trong ESP32: đó là chính thiết bị. HTTP/WS chỉ dành cho thử nghiệm có kiểm soát. Khi vận hành thật, dùng HTTPS/WSS và kiểm tra chứng chỉ TLS trên ESP32.

## Gói đáp án

```json
{
  "v": 1,
  "type": "answer.submit",
  "request_id": "ma-duy-nhat-moi-lan-doi-dap-an",
  "session_id": "lay-tu-snapshot",
  "question_instance_id": "lay-tu-snapshot-question-id",
  "binding_id": "lay-tu-snapshot",
  "seq": 1,
  "choice": "B"
}
```

Mỗi lần đổi đáp án tăng `seq`, tạo request ID mới. Mất ACK thì gửi lại **nguyên gói**, không đổi request ID. Sau reconnect lấy seq/lựa chọn đã lưu từ snapshot. Backend quyết định deadline, không nhận bù theo giờ thiết bị. Xem đầy đủ handshake, heartbeat, lỗi, pause/resume và retry trong [giao thức v1](docs/PROTOCOL.md).

## Vận hành

- Một process backend, một phòng đang chạy/tạm dừng, tối đa 50 người dự thi.
- `npm run teacher:reset-password`: reset mật khẩu, thu hồi phiên cũ.
- `npm run db:backup`: backup SQLite nhất quán; nên sao chép backup sang nơi độc lập.
- `npm run db:restore -- /path/backup.sqlite --confirm-replace`: phục hồi khi app đã dừng, giữ bản database cũ.
- Báo cáo buổi đã kết thúc có thể tạo gợi ý ôn tập bằng OpenRouter Free Router; chỉ cần cấu hình API key ở server, xem [runbook](docs/RUNBOOK.md).
- Trang Báo cáo cho phép nhập kết quả XLSX/CSV đã có để tạo báo cáo lịch sử không cần chạy buổi live; tải mẫu ngay trong trang và xem [runbook](docs/RUNBOOK.md).
- `npm run typecheck`: kiểm tra TypeScript; `npm run build`: build lại sau sửa source.
- `npm run test:auth`: build và kiểm tra đăng ký, đăng nhập, phân quyền giáo viên, giới hạn đăng ký.
- `npm run test:pairing`: build và kiểm tra ROOM ID, quyền/CSRF, thời hạn, retry/rollback, ghép học sinh, ACK, reconnect/restart SQLite, xuất Excel và 50 thiết bị WebSocket. Dùng database tạm riêng, không ghi production.
- Có [Dockerfile](deploy/Dockerfile), [Compose](deploy/compose.yml), [Caddyfile](deploy/Caddyfile) để triển khai HTTPS/WSS; xem [runbook](docs/RUNBOOK.md). Cấu hình container/TLS cần kiểm chứng trên hạ tầng thật.

Bản tải về giữ source, lockfile, migration, công cụ quản trị, kiểm thử đăng ký, cấu hình triển khai và tài liệu kết nối. Không kèm secret, database, tài khoản mẫu, ảnh thiết kế hoặc báo cáo phát triển. Backend vẫn chứa hỗ trợ giả lập trình duyệt tùy chọn để chẩn đoán giao thức, mặc định tắt và không bật trong production.
