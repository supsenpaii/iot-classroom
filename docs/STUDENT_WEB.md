# Làm bài kiểm tra trên web

Học sinh dùng điện thoại hoặc máy tính thay cho ESP32. Trang nằm trong website hiện có,
không cần tài khoản giáo viên và không phụ thuộc `ENABLE_SIMULATOR`.

## Cách dùng

1. Giáo viên thêm MSSV vào lớp trước khi tạo buổi kiểm tra. MSSV trên trang học sinh là
   chuỗi 1–10 chữ số ASCII 0–9; trim hai đầu và giữ số 0 ở đầu. Nội dung sai được
   giữ nguyên để sửa, không tự xóa chữ hoặc cắt ngắn mã. Xem [quy tắc MSSV](STUDENT_CODES.md).
2. Tạo buổi kiểm tra, chọn lớp và bộ đề. Trong phòng chờ, nhấn **Mở nhận thiết bị** để
   tạo Room ID gồm 8 chữ số, có hiệu lực 5 phút.
3. Gửi học sinh đường dẫn **`http://IP_MAY_BACKEND:3000/student`** và Room ID.
   Phòng giáo viên có sẵn đường dẫn trang làm bài. Khi dùng HTTPS hoặc cổng khác,
   dùng đúng địa chỉ website đang chạy và thêm `/student`.
4. Học sinh nhập MSSV và Room ID, nhấn **Vào phòng**. Backend ghép đúng học sinh theo MSSV,
   kể cả khi giáo viên tắt tự ghép. MSSV không có, vắng hoặc đang có thiết bị khác sẽ bị từ chối.
5. Giáo viên bắt đầu. Học sinh đọc câu hỏi trên web và nhấn A/B/C/D. Trang chỉ báo **Đã lưu**
   sau xác nhận của server. Nếu cấu hình khóa lựa chọn đầu tiên, học sinh không đổi được đáp án.
6. Khi kết thúc, trang hiển thị số câu đúng và điểm /10 của chính học sinh. Nút **Vào phòng khác**
   mở lại form nhập phòng. Báo cáo giáo viên chứa cả đáp án từ web và ESP32.

Máy học sinh phải truy cập được backend. Với mạng LAN, dùng `HOST=0.0.0.0` và đặt
`PUBLIC_ORIGIN` thành địa chỉ LAN của máy chạy backend; mở trình duyệt bằng đúng địa chỉ đó.
`localhost` chỉ dùng khi trình duyệt chạy trên chính máy backend.

## Mất mạng và tải lại trang

Trang tự nối lại và đồng bộ trạng thái bài, đáp án đã lưu và thời gian từ server. Lựa chọn
chờ xác nhận được giữ trong tab, gửi lại đúng gói để tránh ghi trùng. Không gửi lựa chọn mới
khi mất kết nối, tạm dừng hoặc hết giờ. Server quyết định hạn trả lời.

Yêu cầu vào phòng và credentials được lưu ở server trước khi ghép. Nếu mất phản hồi,
nhấn **Gửi lại yêu cầu** hoặc tải lại trang để tiếp tục cùng yêu cầu. Retry đã commit vẫn
thành công khi mã phòng hết hạn/đóng nhận. Không đổi MSSV/Room ID trong lúc chưa rõ kết quả.

Cookie học sinh là HttpOnly, độc lập với cookie giáo viên, hiệu lực tối đa 24 giờ mỗi phiên.
Học sinh mở lại bằng cùng trình duyệt để khôi phục bài. Mỗi thiết bị web có một kết nối hiệu lực;
mở ở tab thứ hai sẽ thay thế tab đầu. Gỡ ghép, đánh dấu vắng hoặc thu hồi thiết bị sẽ chặn quyền
làm bài; học sinh hỏi giáo viên để ghép lại. Nếu MSSV đang gắn với ESP32, giáo viên gỡ thiết bị
đó trước khi học sinh vào bằng web.

MSSV và Room ID là thông tin tự khai giống luồng ESP32; giáo viên kiểm tra người tham gia.
Web và ESP32 cùng tính vào giới hạn 50 thiết bị của phòng. Cookie học sinh không cấp quyền
quản lý phòng, xem danh sách lớp, đáp án đúng hay kết quả người khác.

## Cập nhật và kiểm thử

```bash
npm run build
# Khởi động lại tiến trình backend để phục vụ bản mới.
npm start
```

Chạy kiểm thử bằng database tạm, không dùng dữ liệu thật:

```bash
npm run test:student-web
```

Kiểm thử bao gồm Origin/CSRF, tách phiên giáo viên/học sinh, ghép MSSV, retry mất phản hồi,
ticket đúng phiên, phạm vi quyền WebSocket, ACK không ghi trùng, tạm dừng/hết giờ, restart,
kết quả riêng và gỡ khỏi phòng.
