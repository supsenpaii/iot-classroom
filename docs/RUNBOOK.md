# Vận hành và triển khai

## Một máy, một process app

Dùng Node 24.21.0 hoặc Docker image đã build. Không dùng PM2 cluster, nhiều replica, SQLite trên NFS. Ràng buộc phòng trong DB và guard SQLite ngăn hai process trên cùng file. Backend tự áp dụng migration trước nhận kết nối; trong vận hành chạy `db:migrate` lúc app đã dừng để kiểm tra lỗi trước khi mở dịch vụ.

Cấu hình `PUBLIC_ORIGIN` chính xác, không có dấu `/` cuối; production dùng `https://...`. Chạy trực tiếp bundle dùng `http://localhost:3000`; khi thử LAN dùng đúng IP của máy theo README. Không truy cập bằng hostname khác nếu chưa đổi cấu hình. Cookie secure chỉ bật khi `NODE_ENV=production`. `TRUST_PROXY=1` chỉ dùng khi đúng một Caddy đứng trước app, app không mở cổng ra Internet.

`SESSION_SECRET` ngẫu nhiên >= 32 ký tự. File `.env` quyền 600, không commit. Không ghi secret vào `VITE_*`. Database/backups đặt trên ổ đĩa bền vững, giữ quyền truy cập hạn chế.

## Compose + HTTPS

Máy đích cần Docker/Compose, DNS thật, cổng 80/443 thông và dung lượng volume. Không có thao tác mua dịch vụ hay deploy trong lần triển khai code này.

Tại root repository, `.env` production có `PUBLIC_ORIGIN=https://ten-mien-cua-ban`, `SESSION_SECRET` ngẫu nhiên. Compose truyền rõ biến vào service; app được ép `ENABLE_SIMULATOR=false`.

```bash
docker compose --env-file .env -f deploy/compose.yml config --quiet
docker compose --env-file .env -f deploy/compose.yml build
docker compose --env-file .env -f deploy/compose.yml run --rm app npm run db:migrate
docker compose --env-file .env -f deploy/compose.yml run --rm app npm run teacher:create
docker compose --env-file .env -f deploy/compose.yml up -d
docker compose --env-file .env -f deploy/compose.yml ps
docker compose --env-file .env -f deploy/compose.yml logs --tail=100 app
```

App chạy user `node`; volume `/data`, `/backups` khởi tạo quyền từ image. Caddy tự cấp TLS sau khi DNS/mạng sẵn sàng. WebSocket đi qua reverse_proxy. Không bật access log chứa header xác thực; ứng dụng chỉ log mã lỗi/request ID. Kiểm tra HTTPS, login, XLSX, WSS và export trên staging sau khi cấu hình máy chủ thực. Không coi build image là kiểm chứng mạng thực.

## Tài khoản

`npm run teacher:create` hỏi email và mật khẩu ẩn, tối thiểu 12 ký tự. `npm run teacher:reset-password` hỏi tương tự, thu hồi tất cả cookie phiên và grant của giáo viên. Logout/đổi mật khẩu đóng socket liên quan; reset bằng CLI được phát hiện trên message tiếp theo hoặc heartbeat <= 5 giây. UI `/account` đổi mật khẩu khi biết mật khẩu hiện tại.

Không đăng ký công khai, email reset, hoặc tài khoản production mặc định. Bản phân phối không có dữ liệu mẫu hoặc tài khoản mặc định.

## Backup nhất quán

```bash
npm run db:backup
# Trong Compose đang chạy:
docker compose --env-file .env -f deploy/compose.yml exec app npm run db:backup
```

SQLite backup API chụp cả dữ liệu đã commit trong WAL, có thể chạy khi app hoạt động. File chứa timestamp UTC, app/schema version, quyền 600. Không chỉ `cp app.sqlite` khi app đang ghi. Volume backup vẫn ở cùng máy: người vận hành cần sao chép bản backup ra ổ/máy độc lập. Đề xuất lịch hằng ngày, sau buổi quan trọng và trước nâng cấp; giữ 7 bản ngày + 4 bản tuần. Không tự xóa bản cũ trong script.

## Restore

Dừng app. Kiểm tra đúng đích `DATABASE_PATH`, đúng backup và image/schema. Restore cố ý cần cờ `--confirm-replace` để người vận hành xác nhận mất các thay đổi mới hơn backup; công cụ giữ bản DB cũ cạnh file đích.

```bash
npm run db:restore -- /duong-dan/backup.sqlite --confirm-replace
npm run db:migrate
npm start
```

Compose:

```bash
docker compose --env-file .env -f deploy/compose.yml stop app
docker compose --env-file .env -f deploy/compose.yml run --rm app npm run db:restore -- /backups/ten-file.sqlite --confirm-replace
docker compose --env-file .env -f deploy/compose.yml up -d app
```

Công cụ kiểm tra integrity và bảng migrations; guard SQLite từ chối restore khi app đang giữ DB. Khóa được OS nhả khi process chết, không cần xóa lock thủ công. Sau restore kiểm tra login, số lớp/buổi, đáp án mẫu, báo cáo và export. Giữ `SESSION_SECRET` riêng; nếu nghi có lộ phiên, đổi secret để vô hiệu cookie trước mở dịch vụ. Thử restore định kỳ vào môi trường cô lập.

## Nâng cấp / rollback

Khi không có buổi đang thi: backup, dừng app, lưu tag image hiện tại, migrate bằng image mới, khởi động và smoke test. Nếu lỗi schema tương thích thì chạy image cũ; nếu không tương thích, dừng app và restore backup trước migration rồi chạy image cũ. Không restore tự động hoặc âm thầm bỏ dữ liệu phát sinh sau backup.

## Sự cố đang thi

- Mất trình duyệt giáo viên: server tiếp tục. Refresh hoặc nối lại sẽ nhận snapshot, không bốc lại đề.
- Mất thiết bị: báo chưa kết nối, đồng hồ vẫn chạy. Nối lại nhận seq/lựa chọn đã lưu; không nhận bù quá hạn.
- Đổi thiết bị: pause → ghép thiết bị mới → bấm thử → resume. Thiết bị cũ mất quyền, kết quả đã lưu không mất.
- Restart/crash: câu còn thời gian chuyển PAUSED với phần thời gian còn lại tại recovery; quá hạn thì đóng câu và dừng trước câu kế. Giáo viên xem nhật ký, cân nhắc loại câu ảnh hưởng, rồi tiếp tục.
- DB lỗi: không có ACK thành công. Không bấm liên tục để “bù”; giữ gói gửi lại nguyên ID, kiểm tra đĩa/quyền/dung lượng theo request ID. Đã ACK là dữ liệu đã commit, trừ lỗi đĩa/hạ tầng vượt ngoài bảo đảm SQLite.
- Health `/health/live` và `/health/ready`. Backup lỗi, volume đầy, TLS hết hạn cần giám sát của môi trường vận hành; chưa tích hợp dịch vụ giám sát ngoài.

## Giới hạn kiểm chứng ở máy phát triển

Các test phần mềm chạy trên loopback và SQLite cục bộ. Chưa kiểm tra GPIO, debounce, Wi-Fi thật, CA trên ESP32, mất nguồn vật lý, projector/cáp thật hoặc triển khai TLS ở tên miền thật. Docker daemon không có trong môi trường thực hiện nên image/Compose chưa được chạy tại đây; người vận hành cần build và kiểm tra image trên máy có Docker. Trước dùng điểm chính thức cần buổi staging và thiết bị thật.
