# Giao thức ESP32 / giả lập v1

WebSocket chuẩn tại `/ws`. Production dùng WSS cùng origin. JSON UTF-8, tối đa 4 KiB/message, không nén WebSocket, `v: 1`. Tối đa 30 message/giây/socket; một socket có hiệu lực/device, kết nối mới đóng socket cũ mã 4002. Không đưa secret vào URL hoặc log.

## Provision và xác thực

### Ghép nối tự động bằng ROOM ID

Backend và firmware ESP32 hỗ trợ nhập MSSV rồi ROOM ID (firmware dùng credentials đã cấu hình). Không yêu cầu giáo viên duyệt. ROOM ID là **chuỗi 8 chữ số** (giữ số 0 đầu), dùng chung cho nhiều thiết bị, hiệu lực 5 phút theo server. Chỉ nhận trong LOBBY/PAUSED khi giáo viên mở nhận. Bắt đầu/resume/kết thúc/hủy hoặc restart backend đóng nhận mới; thiết bị đã đăng ký vẫn xác thực/reconnect bằng credentials riêng.

`room_code` 6 chữ số trong snapshot v1 cũ chỉ là mã tham chiếu buổi, không được dùng để join. ROOM ID mới chỉ trả qua API/snapshot có quyền giáo viên, trong `pairing.room_code`; không gửi mã này cho projection/device.

Web mới mặc định chọn **Tự ghép học sinh khi thiết bị vào** khi mở nhận. Lệnh open gửi `auto_assign:true`; backend ghép thiết bị mới vào học sinh không vắng/chưa có binding đầu tiên theo thứ tự mã học sinh, trong cùng transaction join. Retry không ghép lại. Khi không còn học sinh trống, thiết bị vẫn vào với `UNASSIGNED`. Có thể bỏ chọn trước khi mở nhận để ghép thủ công; API cũ không có trường này vẫn giữ chế độ thủ công. Việc ghép theo thứ tự không xác minh danh tính người cầm thiết bị: giáo viên kiểm tra tên và sửa ghép nếu cần. Không trả tên/mã học sinh cho thiết bị.

Có thể gửi thêm `student_code` (chuỗi 1–10 chữ số) trong join. Backend ghép đúng MSSV trong danh sách buổi thi, không phụ thuộc `auto_assign`; không tự đổi sang học sinh khác. MSSV không có hoặc vắng trả `STUDENT_UNAVAILABLE`; học sinh đã có thiết bị khác hoặc thiết bị đã ghép học sinh khác trả `STUDENT_ALREADY_BOUND`. Lỗi rollback toàn bộ join. MSSV là thông tin tự khai, không phải bằng chứng xác thực danh tính; giáo viên vẫn kiểm tra người cầm thiết bị. Client cũ không gửi trường này giữ hành vi cũ.

Thiết bị cấu hình trước URL server và Wi-Fi. Tạo secret 32 byte bằng nguồn ngẫu nhiên mật mã, encode **64 ký tự hex thường**, lưu trong NVS trước khi gửi. Tạo/lưu request ID cùng gói join để retry sau mất nguồn/phản hồi. Không suy ra secret từ ROOM ID, MAC hoặc thời gian. Không đổi credentials trước khi biết kết quả join.

```http
POST /api/device-pairing/join
Content-Type: application/json
```

```json
{
  "v": 1,
  "room_code": "48271936",
  "request_id": "unique-persistent-pairing-request-id",
  "device_name": "ESP32-01",
  "device_secret": "<64 lowercase hex characters>"
}
```

Native firmware không cần Origin, cookie giáo viên hoặc CSRF. Production bắt buộc HTTPS, kiểm tra TLS CA; chỉ dùng HTTP khi thử development trong mạng kiểm soát. Không gửi secret/mã trong URL hoặc log. Body tối đa 4 KiB; tên tối đa 80 ký tự, request ID 1–100 ký tự.

Sau commit, trả HTTP 201 (retry đã commit trả 200):

```json
{
  "v": 1,
  "device_id": "device UUID",
  "session_id": "session UUID",
  "label": "ESP32-01",
  "ws_url": "wss://your-server/ws",
  "status": "UNASSIGNED",
  "duplicate": false
}
```

Lưu Device ID và URL; dùng secret đã tạo mở `/ws` bằng header dưới đây. Backend chỉ lưu hash secret. Người dùng chỉ nhập ROOM ID, không thao tác secret. Web tự hiện thiết bị; giáo viên chọn học sinh để tạo binding. Thiết bị chưa ghép nhận snapshot `assignment: "UNASSIGNED"`, có ID/trạng thái buổi, không có câu hỏi/roster/đáp án đúng; được bấm thử trong LOBBY/PAUSED, không được nộp bài tính điểm.

Mất phản hồi: gửi lại **nguyên gói** cùng request ID và secret, kể cả mã đã hết hạn hoặc đóng nhận; không tạo thiết bị trùng. Request ID đổi payload nhận `REQUEST_REUSED`. Nếu giáo viên đã gỡ khỏi phòng, retry cũ trả `DEVICE_REMOVED`; nếu thu hồi hoặc đổi secret, retry cũ không còn hợp lệ. Retry thành công không mở lại cửa sổ nhận.

Thiết bị đã đăng ký muốn vào buổi mới: thêm `device_id`, dùng secret hiện có và request ID mới. Backend tái sử dụng thiết bị; không chuyển chủ sang giáo viên khác. Phải gỡ khỏi phòng cũ nếu phòng đó chưa kết thúc. Khi nhận `DEVICE_OWNER_MISMATCH`, cần đặt lại cấu hình và tạo credentials mới để đăng ký thiết bị mới; lịch sử cũ vẫn thuộc chủ cũ.

Lỗi JSON có `code`, `message`, `requestId`: `ROOM_UNAVAILABLE` (sai/hết hạn/đóng), `ROOM_FULL`, `DEVICE_BUSY`, `DEVICE_OWNER_MISMATCH`, `DEVICE_REMOVED`, `DEVICE_REVOKED`, `REQUEST_REUSED`, `INVALID_PAYLOAD`, `HTTPS_REQUIRED`, `RATE_LIMITED`. Lỗi lưu trữ không trả thành công; với lỗi mạng/5xx giữ nguyên gói để retry có backoff. Phòng tối đa 50 thiết bị chưa thu hồi. Giới hạn 120 lượt join/phút/IP, 240 lượt/phút/backend; HTTP 429 kèm `Retry-After: 60`. Ngưỡng cho phép 50 thiết bị chung NAT và một lượt retry mỗi thiết bị.

Simulator browser vẫn cần đăng nhập giáo viên và `ENABLE_SIMULATOR=true`, gọi `/api/simulator/pairing/join` với Origin/CSRF rồi lấy ticket như cơ chế cũ. Simulator chỉ ghép vào phòng thuộc giáo viên đang đăng nhập. Không có endpoint ticket công khai để biến secret thành quyền truy cập browser.

### Đăng ký thủ công tương thích firmware cũ

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

Chưa vào phòng hoặc buổi đã kết thúc: `data.state = WAITING`. Đã vào bằng ROOM ID nhưng chưa ghép: snapshot có `assignment = UNASSIGNED`, ID và trạng thái buổi, không có `binding_id`. Không gửi tên/mã học sinh, đề đúng, lời giải hoặc secret cho thiết bị. Projection nhận nội dung câu/bốn lựa chọn/tổng số trả lời, không có roster hoặc lựa chọn cá nhân. Trạng thái chính: LOBBY/RUNNING/PAUSED/FINISHED/CANCELLED. Câu: OPEN/CLOSED. Full snapshot luôn là nguồn khôi phục; bỏ snapshot có version cũ. `server_time`/`deadline_at` là milliseconds UTC, thời gian client không có giá trị quyết định hạn.

Khi giáo viên chủ động bấm **Công bố kết quả** sau lúc câu đã đóng, snapshot của màn chiếu mới có `question.results = {counts:{A,B,C,D},correct_answer}`. Trước thời điểm đó `results:null`; firmware vẫn chỉ nhận snapshot tối giản, không nhận đáp án đúng. Snapshot giáo viên có thêm danh sách học sinh, trạng thái đáp án đã commit theo câu, thời điểm ghi nhận và tín hiệu màn chiếu đang kết nối; dữ liệu này không gửi cho projection/device.

Lệnh công bố áp dụng khi buổi còn RUNNING/PAUSED và câu đã CLOSED. Câu cuối đang tự kết thúc buổi ngay khi đóng theo quy tắc hiện tại, nên xem phân bố của câu đó trong báo cáo; không còn phiên trình chiếu để công bố.

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

Phòng chờ hoặc tạm dừng: `{v:1,type:"button.test",choice:"A"}`. Server ghi sự kiện cho giáo viên, trả `{v:1,type:"button.ack",assigned:true}`. Không chấm điểm. Khi buổi đang RUNNING hoặc đã kết thúc, server trả `INVALID_STATE`, không ghi sự kiện và không gửi `button.ack`. Thiết bị chưa ghép nhận `button.ack` với `assigned:false` để kiểm tra kết nối vật lý.

Server gửi WebSocket ping mỗi 5 giây; firmware trả pong (phần lớn thư viện làm tự động). Mất pong quá 15 giây bị ngắt. Có thể gửi ứng dụng `{v:1,type:"heartbeat"}` để nhận server_time. Reconnect 1/2/4/8/10 giây và jitter. Gửi `{v:1,type:"snapshot.request"}` nếu cần đồng bộ lại. Mã đóng 4001: quyền hết hiệu lực; 4002: kết nối mới thay thế; 1008: quá giới hạn message; 1013: client đọc quá chậm.

Thay thiết bị: giáo viên pause, bỏ binding cũ, ghép thiết bị mới, thử nút rồi resume. Thu hồi thiết bị trong trang quản lý vô hiệu secret và ticket, bỏ ghép hiện tại sau commit rồi ngắt socket; thiết bị đã dùng chỉ được lưu lịch sử/ẩn bằng bộ lọc, không xóa vĩnh viễn. Đáp án cũ giữ theo học sinh; thiết bị cũ không gửi tiếp. Restart server chuyển buổi RUNNING sang PAUSED; câu hết hạn được đóng, không tự chạy chuỗi câu. Firmware chờ snapshot mới, không khôi phục đồng hồ từ bộ nhớ riêng.

Phần firmware chưa triển khai: board/GPIO, debounce khoảng 40 ms cần đo, LED/âm báo chỉ xác nhận sau ACK, Wi-Fi provisioning, TLS CA, mất nguồn và kiểm thử access point thật.

## Flashcard: ôn tập cả lớp

Giáo viên mở **Flashcard → bộ thẻ → Bắt đầu ôn tập**. Trong lúc buổi ôn tập chạy, mọi thiết bị của giáo viên đó (chưa thu hồi) nhận snapshot chế độ flashcard, trừ thiết bị đang ghép với bài kiểm tra RUNNING/PAUSED: bài kiểm tra luôn được ưu tiên. Mỗi giáo viên chỉ chạy một buổi ôn tập; không mở được buổi ôn tập khi đang có bài kiểm tra RUNNING/PAUSED.

```json
{
  "v":1,"type":"session.snapshot",
  "data":{
    "mode":"flashcard","id":"review UUID","state":"RUNNING","state_version":7,
    "server_time":1800000000000,
    "card":{"id":"card UUID","index":3,"total":20,"side":"front"},
    "current_rating":null
  }
}
```

Thiết bị không nhận nội dung thẻ (mặt trước/mặt sau chỉ hiện trên màn chiếu). `current_rating` là lựa chọn đã lưu của chính thiết bị cho thẻ hiện tại (`KNOWN`, `AGAIN` hoặc `null`). Snapshot không có `mode` là chế độ kiểm tra như các mục trên. Kết thúc buổi ôn tập: thiết bị quay về snapshot kiểm tra/WAITING.

Học sinh tự đánh giá: firmware hiện tại dùng **A = Nhớ (`KNOWN`)**, **B = Chưa nhớ (`AGAIN`)**; bàn phím 13 phím nên dùng OK = Nhớ, DEL = Chưa nhớ.

```json
{"v":1,"type":"flashcard.rate","request_id":"unique-id","review_id":"review UUID","card_id":"card UUID","rating":"KNOWN"}
```

```json
{"v":1,"type":"flashcard.ack","request_id":"unique-id","accepted":true,"card_id":"card UUID","rating":"KNOWN"}
```

Lựa chọn sau ghi đè lựa chọn trước của cùng thiết bị cho cùng thẻ trong cùng vòng; gửi lại nguyên gói khi mất ACK là an toàn. Vẫn chỉ giữ một request chờ ACK/device như phần đáp án. Lỗi (`accepted:false`): `CARD_CHANGED` (giáo viên đã chuyển thẻ, chờ snapshot mới), `REVIEW_CLOSED`, `DEVICE_BUSY` (thiết bị đang làm bài kiểm tra), `DEVICE_NOT_ASSIGNED`. Sai schema: `error` `INVALID_PAYLOAD`.

Giáo viên nhận cùng loại snapshot qua `{v:1,type:"hello",review_id:"..."}` (cookie đăng nhập), có thêm nội dung thẻ, số Nhớ/Chưa nhớ của thẻ hiện tại, số thiết bị đang kết nối và thống kê vòng. Khi hết vòng, giáo viên có thể mở vòng mới chỉ gồm các thẻ có ít nhất một lượt Chưa nhớ.

## Khảo sát nhanh

Giáo viên mở **Khảo sát nhanh**: một câu và 2–4 lựa chọn A–D, ẩn danh. Mỗi giáo viên chỉ chạy một hoạt động trực tiếp (ôn flashcard, khảo sát hoặc điểm danh); bài kiểm tra RUNNING/PAUSED luôn được ưu tiên như mục flashcard.

```json
{"v":1,"type":"session.snapshot","data":{"mode":"poll","id":"poll UUID","state":"RUNNING","state_version":3,"server_time":1800000000000,"options":4,"current_choice":null}}
```

```json
{"v":1,"type":"poll.vote","request_id":"unique-id","poll_id":"poll UUID","choice":"B"}
```

ACK `{"v":1,"type":"poll.ack","request_id":"...","accepted":true,"choice":"B"}`. Mỗi thiết bị một phiếu, phiếu sau ghi đè phiếu trước. Chỉ `options` phím đầu hợp lệ (2 lựa chọn: A/B). Lỗi: `POLL_CLOSED`, `INVALID_CHOICE`, `DEVICE_BUSY`, `DEVICE_NOT_ASSIGNED`. Giáo viên hello `{v:1,type:"hello",poll_id:"..."}`.

## Điểm danh

Giáo viên gán **thiết bị mặc định** cho học sinh ở trang lớp, rồi **Mở điểm danh**. Thiết bị đã gán cho học sinh trong lớp đó nhận:

```json
{"v":1,"type":"session.snapshot","data":{"mode":"attendance","id":"attendance UUID","state":"RUNNING","state_version":5,"server_time":1800000000000,"checked_in":false}}
```

Bấm phím bất kỳ: `{"v":1,"type":"attendance.checkin","request_id":"unique-id","attendance_id":"attendance UUID"}` → `{"v":1,"type":"attendance.ack","request_id":"...","accepted":true}`. Bấm lại vô hại, giữ thời điểm lần đầu. Thiết bị không nhận tên học sinh. Lỗi: `ATTENDANCE_CLOSED`, `DEVICE_NOT_ASSIGNED`, `DEVICE_BUSY`. Thiết bị mặc định cũng được ghép sẵn khi tạo buổi kiểm tra mới cho lớp (nếu thiết bị không đang ghép ở phòng chưa kết thúc).

## Thi đua

Cấu hình buổi `leaderboard` (mặc định bật). Câu đúng được 500–1000 điểm theo thời gian trả lời, chuỗi đúng liên tiếp thưởng thêm 100/câu (tối đa +500); điểm thi đua tách khỏi điểm /10. Snapshot màn chiếu có `leaderboard` (top 5: `rank,name,points,last_gain,streak`, `name` là tên gọi) chỉ khi giáo viên đã công bố kết quả câu hoặc buổi FINISHED; snapshot giáo viên có `leaderboard_full`. Thiết bị không nhận bảng xếp hạng.

## Đổi tên từ bàn phím ESP32

Socket đã xác thực gửi `{ "v":1, "type":"device.rename", "request_id":"rename-1", "label":"0012345678" }`.
Server chỉ đổi nhãn của chính thiết bị trên socket, giữ nguyên ID, secret và ghép học sinh.
Nhãn là MSSV 1–10 chữ số, giữ số 0 đầu; không trùng thiết bị đang dùng của cùng giáo viên.
Phản hồi `device.rename.ack` có `request_id`, `accepted`, `label`; khi từ chối có `code` là `INVALID_LABEL` hoặc `DUPLICATE_LABEL`.
Gửi lại cùng nhãn là an toàn. Đổi tên không tự gán thiết bị cho học sinh có MSSV đó.

## Tiến độ và kết quả trên ESP32

Snapshot thiết bị có `total_questions`, `seconds_per_question`, `question.question_order` (bắt đầu từ 1).
Khi kết thúc, thiết bị còn được ghép tại thời điểm kết thúc nhận `state: FINISHED` và
`result: {correct, total, score}` của chính học sinh đã ghép. `total` chỉ tính câu đã đóng,
không bị hủy; `score` theo thang 10 giống báo cáo, hoặc null nếu không có điểm.
Trước kết thúc `result` là null. Kết quả cuối được khôi phục khi nối lại, cho đến khi có
lượt ghép mới; thu hồi thiết bị chặn truy cập. Các buổi kết thúc trước bản cập nhật này
không có dấu ghi nhận thiết bị nhận kết quả nên không khôi phục kết quả trên OLED.
