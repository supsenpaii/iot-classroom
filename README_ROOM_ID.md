# Hướng dẫn web mới — ROOM ID và kết nối học sinh

Nhánh `main` chứa web giáo viên, backend và SQLite. Chương trình mô phỏng thiết bị riêng ở nhánh `simu_device`; firmware ESP32 thật chưa có trong repository.

## Tải và chạy lần đầu

Cài Node.js 24.21.0 và npm, rồi chạy:

```bash
git clone --branch main https://github.com/supsenpaii/iot-classroom.git
cd iot-classroom
npm ci
npm run build
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Chỉ copy `.env` khi chưa có file; điền chuỗi ngẫu nhiên vừa tạo vào `SESSION_SECRET`. Mặc định web chạy tại http://localhost:3000, SQLite tại `data/app.sqlite`. Không chia sẻ `.env` hoặc database.

```bash
npm run db:migrate
npm start
```

Mở http://localhost:3000/register để đăng ký email và mật khẩu ít nhất 12 ký tự, sau đó đăng nhập. Không có tài khoản hoặc mật khẩu mặc định. Với máy khác truy cập, cấu hình `HOST`, `PUBLIC_ORIGIN` theo [README](README.md) và [hướng dẫn Tailscale](docs/TAILSCALE_MAY_KHAC.md).

## Chuẩn bị demo 10 câu

Sau khi đăng ký tài khoản, dừng app bằng Ctrl+C. Nếu có dữ liệu cũ, backup trước:

```bash
npm run db:backup
npm run demo:create -- email-cua-ban@example.com
npm start
```

Thay email bằng tài khoản đã đăng ký trong đúng database đang dùng. Lệnh tạo lớp **Lớp DEMO — 10 học sinh**, bộ đề **DEMO — Toán cơ bản 10 câu** và phòng **DEMO ROOM ID — 10 câu**, mỗi câu 15 giây, tự chuyển câu. Mỗi lần chạy tạo bản mới, không sửa dữ liệu cũ. File mẫu nằm riêng ở `samples/demo-room-id-10-cau.json`; app không tự nhập dữ liệu demo khi khởi động.

Có thể tự tạo lớp/thêm học sinh, nhập XLSX/CSV ở ngân hàng câu hỏi, duyệt/lưu đề rồi tạo phòng thay cho dữ liệu mẫu.

## Kết nối bằng ROOM ID

1. Vào phòng kiểm tra ở trạng thái chờ, nhấn **Mở nhận thiết bị**.
2. Giữ lựa chọn tự ghép nếu muốn thiết bị được gán ngay vào học sinh chưa có thiết bị. Thứ tự theo mã học sinh, không suy ra danh tính người cầm thiết bị.
3. Lấy ROOM ID gồm **8 chữ số**, hiệu lực **5 phút**. Thiết bị vẫn cần URL server và mạng Internet/LAN tới server; ROOM ID không chứa cấu hình Wi-Fi.
4. Trên simulator hoặc firmware tương thích, nhập URL web và ROOM ID. Đúng mã thì vào ngay, không cần giáo viên duyệt hoặc nhập secret dài.
5. Tên xuất hiện trong **Học sinh đã kết nối**; kiểm tra người cầm thiết bị, mở **Quản lý thiết bị** để chỉnh lại ghép nếu cần. Nếu tắt tự ghép hoặc hết học sinh trống, phải ghép thủ công trước khi kiểm tra.
6. Bấm A/B/C/D khi chờ để thử nút; thao tác thử không được tính điểm. **Đóng nhận** khi đủ thiết bị, mở màn trình chiếu rồi **Bắt đầu**.

Một thiết bị gắn một học sinh trong buổi. Một backend hỗ trợ một phòng đang hoạt động và tối đa 50 thiết bị. Tạo mã mới làm mã cũ hết hiệu lực. Bắt đầu/tiếp tục/kết thúc hoặc restart server đóng nhận mới; thiết bị đã đăng ký nối lại bằng thông tin đã lưu.

## Khi đang kiểm tra và xem kết quả

Cả lớp trả lời cùng câu trên màn chiếu. Web giáo viên và màn chiếu tách riêng. Backend quyết định thời gian, tự chuyển nếu cấu hình bật, pause/resume và tính hợp lệ của đáp án. Refresh trình duyệt không đặt lại bài.

Chỉ ACK thành công sau commit; gửi lại cùng gói không tính trùng, gói cũ không ghi đè lựa chọn mới. Không gửi đáp án đúng/tên học sinh tới thiết bị. Sau kết thúc, mở **Báo cáo**, xem biểu đồ/ma trận và xuất Excel. Restart trong lúc chạy khôi phục buổi ở trạng thái tạm dừng để giáo viên kiểm tra rồi tiếp tục.

## Xử lý tình huống thường gặp

- Sai mã/hết hạn: mở nhận mới, kiểm tra đủ 8 chữ số và đúng URL server.
- Thiết bị có kết nối nhưng chưa kiểm tra được: xem có ghép học sinh chưa, có đang ở đúng phòng và câu đang mở không.
- Ghép sai tên: chỉnh trong quản lý thiết bị khi chờ/tạm dừng; kiểm tra lại bằng nút thử.
- Thiết bị còn ở phòng cũ chưa kết thúc: gỡ khỏi phòng cũ trước khi nhập mã phòng mới.
- **Gỡ khỏi phòng** bỏ ghép, giữ lịch sử; **Thu hồi** ở mục Thiết bị vô hiệu thông tin xác thực. Xóa profile ở simulator không thu hồi thiết bị trên server.
- Mất mạng: thiết bị reconnect và lấy snapshot; server không nhận bù đáp án quá hạn.
- Đổi máy host/Tailscale: tài khoản nằm trong SQLite, cần chuyển cả database và cấu hình. Xem hướng dẫn chuyển máy trong `docs/`.

## Cập nhật và kiểm thử

Backup rồi dừng app trước khi cập nhật; giữ nguyên `.env`, `data/` và `backups/`:

```bash
git pull --ff-only origin main
npm ci
npm run build
npm run db:migrate
npm start
```

Migration 006/007 bổ sung ROOM ID và tự ghép; không xóa dữ liệu cũ. Kiểm thử dùng database tạm:

```bash
npm run test:auth
npm run test:pairing
```

Bộ kiểm thử ROOM ID bao gồm quyền giáo viên/CSRF, retry/rollback, ghép/sửa ghép, deadline, ACK, pause/reconnect/restart, báo cáo Excel và 50 thiết bị. Hợp đồng HTTPS/WebSocket để làm firmware nằm tại [docs/PROTOCOL.md](docs/PROTOCOL.md). Chưa kiểm chứng bằng phần cứng ESP32 thật.
