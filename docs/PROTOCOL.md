# Giao thức ESP32 / giả lập v1

WebSocket chuẩn tại `/ws`. Production dùng WSS cùng origin. JSON UTF-8, tối đa 4 KiB/message, không nén WebSocket, `v: 1`. Tối đa 30 message/giây/socket; một socket có hiệu lực/device, kết nối mới đóng socket cũ mã 4002. Không đưa secret vào URL hoặc log.

## Provision và xác thực

Giáo viên tạo thiết bị tại `/devices`: lưu `id` và secret chỉ hiện một lần. Backend chỉ giữ SHA-256 của secret 256 bit ngẫu nhiên. Firmware kết nối với:

```text
GET /ws (WebSocket Upgrade)
Authorization: Bearer <secret>
X-Device-Id: <device UUID>
```

Firmware không cần gửi Origin. Browser bắt buộc đúng PUBLIC_ORIGIN; không thể gửi header secret từ API WebSocket gốc. Simulator đăng nhập giáo viên, POST `/api/devices/:id/ticket` với CSRF rồi gửi `{ "v":1, "type":"hello", "ticket":"..." }`. Ticket chỉ dùng một lần trong 60 giây; tự lấy mới khi nối lại. Ticket không phải thông tin provision lâu dài.

Giáo viên dùng cookie, gửi `{ "v":1,"type":"hello","session_id":"..." }`; server kiểm tra quyền sở hữu. Projection dùng grant từ `/api/presentation/exchange`, hello với `ticket`. Projection không được dùng API ghi hoặc gửi đáp án. Logout/đổi mật khẩu/thu hồi quyền đóng socket liên quan. Firmware phải xác minh chứng chỉ TLS (CA và thời gian); không dùng insecure TLS.

## Snapshot

Server gửi ngay sau kết nối và khi có thay đổi (gom trong tối đa khoảng 40 ms), cùng heartbeat cập nhật trạng thái. Firmware nhận tối thiểu:

```json
{
  "v":1,"type":"session.snapshot",
  "data":{
    "id":"session UUID","state":"RUNNING","state_version":4,
    "server_time":1800000000000,"binding_id":"binding UUID",
    "question":{"id":"question instance UUID","status":"OPEN","deadline_at":1800000030000,"remaining_ms":null},
    "current_answer":{"choice":"B","seq":2}
  }
}
```

Chưa ghép hoặc buổi đã kết thúc: `data.state = WAITING`. Không gửi tên/mã học sinh, đề đúng, lời giải hoặc secret cho thiết bị. Projection nhận nội dung câu/bốn lựa chọn/tổng số trả lời, không có roster hoặc lựa chọn cá nhân. Trạng thái chính: LOBBY/RUNNING/PAUSED/FINISHED/CANCELLED. Câu: OPEN/CLOSED. Full snapshot luôn là nguồn khôi phục; bỏ snapshot có version cũ. `server_time`/`deadline_at` là milliseconds UTC, thời gian client không có giá trị quyết định hạn.

## Đáp án và ACK

```json
{"v":1,"type":"answer.submit","request_id":"uuid-or-unique-device-id","session_id":"session UUID","question_instance_id":"instance UUID","binding_id":"binding UUID","seq":3,"choice":"B"}
```

Không gửi student_id. Server suy ra học sinh từ binding. Request ID dài 1–100 ký tự; seq số nguyên dương <= 2147483647. Mỗi lần đổi chọn tăng seq và tạo request_id mới. Scope sequence: binding + question. Sau reconnect lấy `current_answer.seq` trước khi gửi tiếp; sau thay binding bắt đầu từ seq trong snapshot (0 nếu đáp án thuộc binding cũ).

```json
{"v":1,"type":"answer.ack","request_id":"...","accepted":true,"choice":"B","seq":3,"duplicate":false}
```

ACK thành công chỉ sau transaction đã commit đáp án + receipt. Không ACK thành công khi DB lỗi. Nếu không nhận ACK, gửi nguyên packet/request_id; bản sao trả receipt cũ và `duplicate:true`, kể cả câu/buổi đã đóng. Receipt cũ không thay đáp án mới. Gửi lại request_id khác nội dung nhận REQUEST_REUSED. Không cộng trùng.

Lỗi đáp án: QUESTION_CLOSED, SESSION_PAUSED, STALE_SEQUENCE, DEVICE_NOT_ASSIGNED, ANSWER_LOCKED, REQUEST_REUSED. Payload/schema hoặc message không hợp lệ: `{v:1,type:"error",code:"INVALID_PAYLOAD"}`; lỗi DB: STORAGE_ERROR. Không chứa đáp án đúng.

Chỉ giữ một request chờ ACK/device. Các lần bấm tiếp theo lưu lựa chọn mới nhất, gửi sau ACK. Đặt timeout ban đầu khoảng 1,2 giây, retry nguyên gói; không tự coi retry thành công. Gói mới chỉ hợp lệ nếu backend đang RUNNING, câu OPEN và `now < deadline_at`. Không nhận bù dựa trên giờ ESP32. Không cho gửi câu mới khi tạm dừng hoặc hết hạn. Receipt đã commit có thể ACK lại sau hạn.

## Thử nút / heartbeat / nối lại

Phòng chờ hoặc tạm dừng: `{v:1,type:"button.test",choice:"A"}`. Server ghi sự kiện cho giáo viên, trả `{v:1,type:"button.ack",assigned:true}`. Không chấm điểm.

Server gửi WebSocket ping mỗi 5 giây; firmware trả pong (phần lớn thư viện làm tự động). Mất pong quá 15 giây bị ngắt. Có thể gửi ứng dụng `{v:1,type:"heartbeat"}` để nhận server_time. Reconnect 1/2/4/8/10 giây và jitter. Gửi `{v:1,type:"snapshot.request"}` nếu cần đồng bộ lại. Mã đóng 4001: quyền hết hiệu lực; 4002: kết nối mới thay thế; 1008: quá giới hạn message; 1013: client đọc quá chậm.

Thay thiết bị: giáo viên pause, bỏ binding cũ, ghép thiết bị mới, thử nút rồi resume. Đáp án cũ giữ theo học sinh; thiết bị cũ không gửi tiếp. Restart server chuyển buổi RUNNING sang PAUSED; câu hết hạn được đóng, không tự chạy chuỗi câu. Firmware chờ snapshot mới, không khôi phục đồng hồ từ bộ nhớ riêng.

Phần firmware chưa triển khai: board/GPIO, debounce khoảng 40 ms cần đo, LED/âm báo chỉ xác nhận sau ACK, Wi-Fi provisioning, TLS CA, mất nguồn và kiểm thử access point thật.
