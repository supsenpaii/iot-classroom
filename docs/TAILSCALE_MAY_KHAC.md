# Chuyển website sang máy Tailscale khác

Hướng dẫn này áp dụng cho máy mới chạy Ubuntu/Linux, Node 24.21.0 và một bản app SQLite. Máy mới có thể dùng **tài khoản Tailscale khác**: mời tài khoản đó vào cùng tailnet, hoặc dùng tailnet riêng. Hai máy được phép cùng online; mỗi máy có tên Funnel riêng. Tailscale không tự chuyển app, database hay giữ nguyên URL cũ. Chỉ một máy nên nhận bài kiểm tra thật tại một thời điểm.

Trước khi bắt đầu, chọn lúc **không có buổi kiểm tra đang chạy**. Chuẩn bị quyền đăng nhập máy mới, đủ dung lượng cho database/backup và Internet ổn định. Không đưa `.env`, secret hoặc file `.sqlite` lên GitHub.

## 1. Bật Tailscale trên máy mới

Cài Tailscale theo [hướng dẫn Linux chính thức](https://tailscale.com/download/linux), sau đó đăng nhập trên máy mới:

```bash
sudo tailscale up
tailscale status
```

Nếu hai tài khoản muốn ở **cùng tailnet**, chủ tailnet mời tài khoản mới theo [hướng dẫn mời người dùng](https://tailscale.com/docs/features/sharing/how-to/invite-team-members). Nếu dùng hai tailnet riêng, máy mới vẫn bật Funnel được nhưng sẽ có tên miền thuộc tailnet mới; hai máy không tự nhìn thấy nhau qua mạng riêng. Trên máy mới bật Funnel cho cổng app local:

```bash
tailscale funnel --bg 3000
tailscale funnel status
```

Lưu URL `https://<ten-may>.<tailnet>.ts.net` mà lệnh in ra. Funnel có thể yêu cầu bật HTTPS/MagicDNS hoặc phê duyệt quyền lần đầu. `--bg` giữ cấu hình Funnel qua lần khởi động lại Tailscale theo [tài liệu Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel). URL của máy cũ không tự chuyển sang máy mới.

## 2. Sao lưu database thật trên máy hiện tại

Máy hiện tại đang dùng service `iot-classroom-public.service` và file cấu hình riêng tại `/home/sup/.local/state/iot-classroom-funnel/app.env`. Trong thư mục source hiện tại, chạy:

```bash
cd "/home/sup/IOT project"
nvm use
systemctl --user stop iot-classroom-public.service
node --env-file=/home/sup/.local/state/iot-classroom-funnel/app.env dist/server/scripts/admin.js backup
```

Lệnh cuối in ra **đường dẫn backup `.sqlite`**. Chép đúng file đó sang máy mới bằng USB hoặc `scp` nếu hai máy liên lạc được. Ví dụ, thay đường dẫn/địa chỉ thật:

```bash
scp /duong-dan/backup.sqlite ten-user@ten-may-moi:/home/ten-user/
```

Lệnh backup dùng SQLite Backup API để chụp dữ liệu nhất quán. **Đừng dùng `.env` của bản demo local** hoặc chỉ copy file database đang được app ghi: chúng có thể không phải dữ liệu web công khai hoặc thiếu dữ liệu WAL. Giữ bản backup cũ ở nơi an toàn. Nếu `nvm` chưa có trong shell, nạp nvm trước hoặc dùng Node 24.21.0 theo README.

## 3. Cài app trên máy mới và khôi phục dữ liệu

Trên máy mới, cài Node 24.21.0/npm như README rồi chạy:

```bash
git clone https://github.com/supsenpaii/iot-classroom.git
cd iot-classroom
nvm install
nvm use
npm ci
npm run build
cp .env.example .env
chmod 600 .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Sửa `.env`: dán chuỗi vừa tạo vào `SESSION_SECRET` và đặt các giá trị sau. Dùng **đúng URL Funnel của máy mới**, không thêm dấu `/` cuối:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=https://<ten-may>.<tailnet>.ts.net
DATABASE_PATH=./data/app.sqlite
SESSION_SECRET=<chuoi-ngau-nhien-it-nhat-32-ky-tu>
TRUST_PROXY=1
ENABLE_SIMULATOR=false
BACKUP_DIR=./backups
```

`HOST=127.0.0.1` giữ cổng app chỉ ở máy mới; Funnel là reverse proxy HTTPS/WSS. Không dùng đồng thời Compose/Caddy trên cùng cổng trong cách cài này. Khôi phục file backup đã chép tới máy mới **trước khi khởi động app**:

```bash
npm run db:restore -- /home/ten-user/backup.sqlite --confirm-replace
npm run db:migrate
npm start
```

`--confirm-replace` sẽ thay database đích nếu đã có; hãy kiểm tra đường dẫn backup và `DATABASE_PATH` trước khi chạy. Sau khi `npm start` báo đã nghe cổng 3000, mở một terminal khác kiểm tra `curl -f http://127.0.0.1:3000/health/ready`, rồi mở URL Funnel mới trên điện thoại dùng mạng di động. Đăng nhập, kiểm tra lớp, thiết bị, bộ đề và báo cáo cũ. Dừng tiến trình chạy thử bằng `Ctrl+C` trước bước tiếp theo.

## 4. Cho app tự chạy sau khi khởi động máy

Trong thư mục `iot-classroom` trên máy mới, tạo service user bằng đường dẫn Node và thư mục hiện tại:

```bash
NODE_BIN="$(command -v node)"
PROJECT_DIR="$(pwd)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/iot-classroom.service" <<EOF
[Unit]
Description=IOT Classroom web
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN --env-file=.env dist/server/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now iot-classroom.service
systemctl --user status iot-classroom.service
sudo loginctl enable-linger "$USER"
```

`enable-linger` giúp service user tiếp tục chạy sau khi đăng xuất. Kiểm tra lại URL công khai sau một lần khởi động lại máy. Trên máy cũ, giữ service app đã dừng; có thể tắt Funnel cũ nếu không dùng nữa bằng `tailscale funnel --https=443 off` trên **máy cũ**. Đừng xóa database/backup cũ trước khi đã xác nhận dữ liệu trên máy mới.

## 5. Đổi địa chỉ trên ESP32 và kiểm tra buổi thử

ESP32 phải dùng `wss://<ten-may>.<tailnet>.ts.net/ws` mới, không dùng URL của laptop cũ. Nếu database đã được restore, Device ID và secret đã lưu trong firmware vẫn thuộc thiết bị cũ; có thể mở **Thiết bị → Device ID** trên web mới để xem URL và ID. Secret cũ không xem lại được, chỉ **Cấp lại** khi cần nạp secret mới vào firmware. Kiểm tra chứng chỉ TLS/CA trong firmware, cho một thiết bị kết nối, bấm `button.test`, rồi chạy một buổi thử và xem báo cáo.

Hai máy có thể bật Tailscale cùng lúc, nhưng **không có đồng bộ SQLite hay chuyển máy tự động**. Nếu máy mới nhận bài rồi cần quay về máy cũ, phải dừng máy mới, tạo backup mới và restore ngược; không khởi động máy cũ với bản dữ liệu cũ để tiếp tục bài thật. Xem [runbook](RUNBOOK.md) để xử lý backup/restore và [giao thức ESP32](PROTOCOL.md).
