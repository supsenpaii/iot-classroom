# Hướng dẫn chạy demo — Lớp học tương tác ESP32

Tổng hợp từ `README.md`, `esp32-simulator/README.md`, `package.json`, `.env`, `scripts/seed-room-demo.mjs`.

## 1. Tổng quan

| Thành phần | Vai trò | Cổng |
| --- | --- | --- |
| Web + backend (Express, SQLite, WebSocket) | Giáo viên điều khiển, màn chiếu, báo cáo | `3000` |
| ESP32 simulator độc lập (`esp32-simulator/`) | Giả lập thiết bị học sinh bấm A/B/C/D | `3210` |
| Trang `/simulator` (tích hợp trong web) | Cách giả lập thứ hai, cần `ENABLE_SIMULATOR=true` | `3000` |

Chưa có firmware ESP32 thật trong repo — demo dùng simulator.

## 2. Yêu cầu

- Node.js **24.21.0** (`engines` trong `package.json`; có `.nvmrc`). Máy hiện đang là **v22.16.0** → chạy `nvm install && nvm use` trước.
- npm. Không cần Docker cho demo.

## 3. Chuẩn bị (một lần)

```bash
cd "/home/sup/IOT project"
nvm use                 # Node 24.21.0
npm ci
npm run build           # typecheck + build client + server → dist/
```

Kiểm tra `.env` (đã có sẵn trên máy, DB demo là `./data/demo.sqlite`):

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
DATABASE_PATH=./data/demo.sqlite
ENABLE_SIMULATOR=true
SESSION_SECRET=<chuỗi ngẫu nhiên>   # bắt buộc
```

Nếu chưa có `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

rồi dán vào `.env`. Sau đó tạo schema DB:

```bash
npm run db:migrate
```

## 4. Chạy web

```bash
npm start               # http://localhost:3000
```

Mở **http://localhost:3000/register** → tạo tài khoản giáo viên (email + mật khẩu ≥ 12 ký tự). Hoặc dùng terminal: `npm run teacher:create`.

## 5. Tạo dữ liệu demo nhanh (tùy chọn)

Dừng app (Ctrl+C) và backup trước (`npm run db:backup`), rồi:

```bash
npm run demo:create -- email-giao-vien@example.com
npm start
```

Tạo sẵn: lớp 10 học sinh (`DEMO01…DEMO10`), bộ đề Toán 10 câu, buổi **"DEMO ROOM ID — 10 câu"** (15 giây/câu, tự chuyển câu). Dữ liệu nguồn: `samples/demo-room-id-10-cau.json`. Nếu bỏ qua bước này, tự tạo lớp/đề/buổi trên web.

## 6. Kịch bản demo (ROOM ID)

1. Đăng nhập web → vào buổi kiểm tra demo (phòng kiểm tra).
2. Nhấn **Mở nhận thiết bị** → được **ROOM ID 8 chữ số** (hiệu lực 5 phút; mặc định tự ghép thiết bị vào học sinh chưa có thiết bị).
3. Kết nối thiết bị giả lập — chọn **một** trong hai cách:

   **Cách A — simulator độc lập (khuyến nghị, giống firmware nhất):**
   ```bash
   cd "/home/sup/IOT project/esp32-simulator"
   npm ci
   CLASSROOM_URL=http://localhost:3000 npm start   # http://localhost:3210
   ```
   Mở http://localhost:3210 → nhập URL web → đặt tên `ESP32-01` → **Thêm thiết bị** → nhập ROOM ID → **Vào phòng**. Lặp lại để thêm nhiều thiết bị (tối đa 50).

   **Cách B — trang `/simulator` trong web** (cần `ENABLE_SIMULATOR=true`, restart app):
   mở http://localhost:3000/simulator → nhập ROOM ID + số thiết bị (1–50) → **Kết nối bằng mã**.

4. Trên web, kiểm tra mục **Học sinh đã kết nối** (tên hiện ngay nếu tự ghép); sửa ghép trong **Quản lý thiết bị** nếu cần. Bấm A/B/C/D trên simulator để thử (`button.test`, chưa chấm điểm).
5. Mở **màn hình trình chiếu** ở tab/cửa sổ khác, nhấn **Bắt đầu**.
6. Trên simulator bấm A/B/C/D (hoặc phím `A–D`/`1–4`) trả lời; đèn xác nhận bật sau khi server ACK.
7. Kết thúc bài → **Báo cáo**: biểu đồ, ma trận học sinh × câu, xuất Excel/PDF.

Thử sự cố trong simulator: **Ngắt mạng / Nối lại**, **Khởi động lại**, **Mất ACK một lần**, **Gửi lại gói cuối**.

Tính năng phụ có thể demo thêm: Flashcard (A = Nhớ, B = Chưa nhớ), Khảo sát nhanh, Điểm danh, Thi đua (top 5 + bục vinh danh).

## 7. Kiểm thử tự động

```bash
npm run test:auth              # đăng ký/đăng nhập/phân quyền
npm run test:pairing           # ROOM ID, ACK, reconnect, Excel, 50 thiết bị (DB tạm)
npm run test:device-simulator  # tích hợp simulator độc lập với backend thật
```

## 8. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
| --- | --- |
| `engines`/lỗi native `better-sqlite3` | Dùng đúng Node 24.21.0 rồi `npm ci` lại |
| Server không khởi động, thiếu secret | Điền `SESSION_SECRET` trong `.env` |
| Mở `localhost` nhưng `PUBLIC_ORIGIN` là IP | Mở đúng `PUBLIC_ORIGIN` |
| ROOM ID sai/hết hạn | Nhấn **Mở nhận thiết bị** lấy mã mới (5 phút) |
| Thiết bị đã ở phòng khác | **Gỡ khỏi phòng** cũ trước khi vào phòng mới |
| `/simulator` không có | Đặt `ENABLE_SIMULATOR=true` (chỉ dev) rồi restart |
| Simulator đổi server | Thêm profile mới; credentials lưu ở `~/.iot-esp32-simulator/devices.json` |
| `demo:create` báo lock | Dừng `npm start` trước khi chạy |

## 9. Lưu ý

- Không bật `ENABLE_SIMULATOR` trên production; không commit `.env`, DB hay secret thiết bị.
- Tối đa 1 phòng đang chạy và 50 thiết bị.
- Đây là mô phỏng giao thức, chưa kiểm chứng với ESP32 thật (GPIO, Wi-Fi, pin).
- Muốn demo từ máy khác/Internet: xem `docs/TAILSCALE_MAY_KHAC.md` (Tailscale Funnel) hoặc `deploy/` (Docker + Caddy HTTPS).
