# Kiểm tra một buổi thật trước khi dạy

Làm một lần, khoảng 20–30 phút, với 3–5 thiết bị và 1–2 điện thoại. Tích dấu từng dòng; dòng nào không đạt thì ghi lại và dừng.

## Chuẩn bị
- [ ] `.env`: `PUBLIC_ORIGIN` đúng link (Funnel hoặc IP LAN), `TRUST_PROXY=1` nếu qua Funnel/Caddy, `SESSION_SECRET` dài, `GEMINI_API_KEY` mới.
- [ ] `npm run build && npm run db:migrate`, rồi `npm start`; log không có dòng "Cảnh báo: … TRUST_PROXY".
- [ ] Mở link công khai trên **điện thoại ngoài mạng nhà**: thấy trang đăng nhập, ổ khóa HTTPS.

## Buổi thử
- [ ] Tạo lớp 5 học sinh, bộ đề 5–10 câu, buổi kiểm tra 20 giây/câu.
- [ ] **Mở nhận thiết bị**, lấy ROOM ID. ESP32 thật vào được; một điện thoại vào `/device`, một điện thoại khác vào `/student`.
- [ ] Cả ba hiện trong "Học sinh đã kết nối" với đúng tên.
- [ ] Bấm thử A/B/C/D ở phòng chờ: giáo viên thấy "Bấm thử".
- [ ] Bắt đầu. Mỗi thiết bị trả lời; OLED/ màn hình hiện "SAVED" sau khi server nhận; giáo viên thấy số đáp án tăng.
- [ ] Tắt Wi-Fi một thiết bị 10 giây giữa câu, bật lại: tự nối lại, đáp án đã lưu không mất.
- [ ] Tạm dừng, tiếp tục; hết giờ chuyển câu đúng.
- [ ] Kết thúc: thiết bị hiện điểm; báo cáo khớp số câu đúng; xuất Excel mở được.

## AI
- [ ] Ở báo cáo, chọn học sinh có câu sai → **AI giải chi tiết**. Đọc lời giải: đúng đáp án, không bịa; bấm lại mở bản đã lưu (không chờ).
- [ ] **Tạo link luyện thêm**, mở link trên điện thoại: thấy câu và lật được thẻ.

## Sau buổi
- [ ] `npm run db:backup` chạy được; file nằm trong `BACKUP_DIR`.
- [ ] Ghi các điểm không ổn (chữ khó hiểu, bước thừa) vào `BAO_CAO_BUG_VA_CACH_SUA_*.md` hoặc gửi lại để sửa.
