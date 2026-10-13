# Quy tắc MSSV — BUG 04

MSSV luôn là **string** gồm 1–10 chữ số ASCII `0–9`. Trim khoảng trắng hai đầu
trước khi kiểm tra bằng `/^[0-9]{1,10}$/`. Không chuyển number thành string,
không xóa ký tự sai, không cho phép chữ hoặc khoảng trắng bên trong.
`"001"` và `"1"` là hai học sinh khác nhau.

Schema dùng chung nằm ở `shared/student-code.ts`. Tạo/sửa học sinh, import học sinh,
import kết quả, Student Web và HTTP device pairing đều dùng schema này.
Packet/API giữ nguyên cấu trúc; quiz A/B/C/D, ACK/retry, binding và SQLite schema
không thay đổi. Join không gửi MSSV vẫn vào phòng chờ ghép thủ công; nhãn thiết bị
độc lập với MSSV. Firmware hiện tại nhập 1–10 chữ số vẫn tương thích.

## Nhập liệu và Excel

Student Web, form học sinh và bản xem trước import giữ nguyên nội dung sai để sửa,
báo lỗi và chặn gửi. Giới hạn 10 chữ số được kiểm tra khi xác nhận, thay vì cắt ngắn
nội dung dán hoặc xóa chữ có thể biến mã sai thành MSSV của học sinh khác.
Khoảng trắng hai đầu được trim trong payload hợp lệ, số 0 đầu được giữ nguyên.

CSV được đọc như văn bản. Trong XLSX, đặt cột `student_code` là **Text trước khi nhập**.
Ô kiểu số bị từ chối ở cả import học sinh và kết quả, kể cả có định dạng hiển thị
`000`: không thể xác định số 0 đầu đã mất. Đổi định dạng sang Text sau khi Excel đã
làm mất số 0 không khôi phục MSSV; cần đối chiếu mã gốc. Công thức vẫn bị từ chối.
File mẫu và dữ liệu demo mới sử dụng mã số dạng string. Export giữ giá trị lịch sử.

## Dữ liệu cũ và phiên hiện có

Không migration, không tự sửa/xóa/gộp mã đã lưu, không đổi snapshot hoặc kết quả cũ.
MSSV chứa chữ, dài quá 10 chữ số, hoặc có khoảng trắng được lưu từ trước vẫn đọc và
export được. Tạo quiz, điểm danh hoặc import kết quả vào lớp có mã cũ không hợp lệ
bị chặn bằng `INVALID_STUDENT_CODE` (HTTP 422), kèm danh sách mã cần kiểm tra.
Không tự bỏ học sinh khỏi danh sách để tạo phiên.

Phiên đã tạo vẫn tiếp tục chấm điểm và ghép thủ công theo ID snapshot cũ.
Join mới bằng MSSV không hợp lệ bị từ chối bằng `INVALID_PAYLOAD` (HTTP 422),
nhưng reconnect bằng credentials/binding hiện có không kiểm tra lại mã lịch sử.
Người dùng cần xác nhận việc sửa mã cũ riêng trước khi dùng lớp đó tạo phiên mới.

## Kiểm thử

Sau `npm run build`, chạy `node scripts/test-student-code.mjs` và
`node scripts/test-student-code-ui.mjs`. Script backend chỉ dùng SQLite `:memory:`
hoặc database tạm riêng; script giao diện dùng Chromium với API giả lập.
Chạy tiếp toàn bộ `scripts/test-*.mjs` để kiểm tra guards, flashcard replay,
AI/review deck, pairing, reconnect, chấm điểm và 50 WebSocket clients.

## Phạm vi thay đổi

- Shared: `shared/student-code.ts` (mới).
- Backend: `server/student-codes.ts` (mới), `server/imports.ts`,
  `server/import-worker.mjs`, `server/student.ts`, `server/pairing.ts`,
  `server/app.ts`, `server/quiz.ts`, `server/live.ts`.
- Frontend: `client/src/pages/student.tsx`, `client/src/pages/manage.tsx`.
- Dữ liệu demo mới: `scripts/seed-room-demo.mjs`.
- Test mới: `scripts/test-student-code.mjs`, `scripts/test-student-code-ui.mjs`.
- Tài liệu: `docs/STUDENT_CODES.md` (mới), `docs/PROTOCOL.md`, `docs/STUDENT_WEB.md`.

## Kết quả xác minh ngày 13/10/2026

Tạo regression trước khi sửa: 35/57 test backend và 16/18 test giao diện thất bại.
Sau sửa: backend **57/57**, giao diện Chromium **18/18**, tổng **75/75 PASS**.
Tất cả **16/16 test scripts PASS**, gồm Activity Guard **29/29**, Flashcard Replay
**27/27**, AI/Review Deck **30/30** và kiểm thử **50 WebSocket clients**.
`npm run typecheck`, `npm run build`, `git diff --check` đều PASS.

Build/test chạy trên bản sao source trong workspace tạm để không đụng backend và
database thật đang chạy. 93 file ngoài phạm vi được đối chiếu SHA-256 với đầu lượt
và giữ nguyên, gồm firmware/config, `.vscode`, `.env`, dependencies, clipboard và
các file riêng của BUG 01–03. Các bổ sung vào `quiz.ts`/`live.ts` không đổi guard,
transaction, chấm điểm, ACK/retry hoặc binding.

Chưa chạy end-to-end browser với backend thật/Excel desktop, chưa kiểm tra ESP32
thật trong lượt này và chưa thống kê MSSV cũ trên database thật. Browser regression
dùng React thật với API giả lập; HTTP/WebSocket regression dùng server thật cùng
SQLite `:memory:` hoặc file database test độc lập. Không restart/triển khai app,
không migration/sửa dữ liệu thật, không commit/push và không thực hiện BUG 05.
