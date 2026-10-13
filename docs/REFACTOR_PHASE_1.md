# SmartClass — rà soát và refactor Giai đoạn 1

Ngày: 2026-10-12. Baseline: `33558c6`.

**Trạng thái: đã thực hiện phạm vi refactor nhỏ bên dưới, nhưng chưa đủ điều kiện nghiệm thu Giai đoạn 1.** Bộ test hiện có vẫn có một bài thất bại trước và sau thay đổi. Không triển khai Giai đoạn 2–5.

## A. Những vấn đề đã xác minh

### Khảo sát và dependency

- Git sạch khi bắt đầu và khi tiếp tục sau gián đoạn; không có chỉnh sửa sẵn cần hoàn tác hoặc ghi đè. Không tìm thấy `AGENTS.md` áp dụng trong repository hoặc các thư mục cha đã kiểm tra.
- Không tìm thấy bản báo cáo review độc lập trong repository. Đối chiếu theo mô tả người dùng cung cấp, không suy diễn theo mã Fxx.
- Backend: `server/index.ts` → `openDb()` và `createApplication()` → authentication, `Quiz`, `Pairing`, `Flashcards`, `Polls`, `Attendance`, student portal và realtime. `openDb()` tự áp dụng migrations; vì vậy không chạy entry point này với database thật.
- `Quiz` phụ thuộc database, shared schemas, hashing và leaderboard. `realtime.ts` dùng các service để quyết định snapshot và xử lý packet. Worker trong `imports.ts` giữ việc đọc file ngoài luồng chính.
- Frontend: `client/src/main.tsx` tải các trang; `components.tsx` cung cấp context/hook; `api.ts` xử lý HTTP/CSRF; `socket.ts` và `student-client.ts` xử lý kết nối realtime. Firmware `src/main.cpp` dùng các HTTP/WebSocket contract hiện có.
- Trước thay đổi, `app.ts` có 1.489 dòng, `quiz.ts` 908 dòng, `realtime.ts` 589 dòng và `manage.tsx` 1.108 dòng. Chỉ tách hai phần độc lập; không viết lại các module lớn.
- Đã kiểm tra và giữ nguyên deadline phía backend; transaction của answer/receipt/event; `request_id`/`seq`; snapshot học sinh/câu hỏi; `expected_version`/`command_id`; WAL, foreign keys; scrypt; CSRF/Origin/session/ownership; import worker.

### Đối chiếu review cũ

| Mô tả | Trạng thái theo source hiện tại | Ảnh hưởng / file |
| --- | --- | --- |
| Simulator ghép sai hoặc không ghép MSSV | Còn tồn tại: batch vào phòng dùng nhãn `SIM-ROOM-*`, không gửi `student_code`; binding yêu cầu nhãn trùng MSSV | Cao; `client/src/pages/simulator.tsx`, `server/quiz.ts`, `server/pairing.ts` |
| Flashcard nhận packet từ vòng trước | Còn thiếu phân biệt vòng/lượt xuất hiện: packet strict chỉ có review/card/rating; `rate()` ghi vào vòng hiện tại nếu card ID khớp | Cao; `shared/protocol.ts`, `server/flashcards.ts` |
| Guard quiz/flashcard/poll/attendance không nhất quán | `assertIdle()` được các hoạt động phụ dùng; `Quiz.command(start)` chỉ chặn quiz RUNNING/PAUSED và không kiểm tra các hoạt động phụ | Cao; `server/live.ts`, `server/flashcards.ts`, `server/quiz.ts` |
| Async response hiển thị sai học sinh | Còn tồn tại trong StudyPlan: đổi học sinh xóa kết quả, nhưng promise cũ vẫn có thể gọi `setDeck`/`setAiGuide` | Vừa; `client/src/pages/study-plan.tsx` |
| Quy tắc MSSV không thống nhất | Import nhận chuỗi 1–50 ký tự; pairing/student-web nhận 1–10 chữ số | Vừa; `server/imports.ts`, `server/pairing.ts`, `server/student.ts` |
| Ghép thiết bị đúng MSSV | Đã có kiểm tra `device.label === student_code`, và test student-room-pairing pass; điều này chưa giải quyết luồng batch simulator | `server/quiz.ts`, `scripts/test-student-room-pairing.mjs` |
| Response time của báo cáo import | Đã trả `null` ở cấp học sinh và chi tiết đáp án; cấp câu hỏi vẫn trung bình các giá trị 0 do import ghi, có thể hiển thị 0 giây | Vừa; `server/app.ts`, `server/quiz.ts`, `client/src/pages/results-grid.tsx`, `server/imports.ts` |
| Credential trong firmware example | File được Git theo dõi; các giá trị cấu hình không phải placeholder. Chưa xác minh credential còn hiệu lực | Cao; `firmware/esp32-classroom/include/device_config.example.h:3` và `:5`. Không hiển thị giá trị |
| Mật khẩu một ký tự | Vẫn được chấp nhận, thể hiện trong schema và test registration | Cao; `server/app.ts`, `scripts/test-registration.mjs` |
| MSSV/ROOM ID chưa đủ xác thực danh tính | Student-web có cookie, CSRF và scoped ticket sau khi join, nhưng join vẫn dựa trên MSSV và mã phòng, không có chứng minh danh tính riêng | Cao; `server/student.ts` |
| Advisory của source-map-js | Lockfile vẫn có `source-map-js@1.2.1`; chưa xác minh advisory hiện hành hoặc khả năng khai thác | Để Giai đoạn 5; `package-lock.json` |
| Build dùng cp | Vẫn dùng shell `cp`; helper `scripts/copy-build-assets.mjs` đã tồn tại nhưng chưa được build script sử dụng | Thấp; `package.json`. Chưa chạy trên Windows native |

Những kết luận về lỗi nghiệp vụ trên chủ yếu là rà soát source; chưa tạo regression test hay sửa chúng trong lượt này.

### Nguyên nhân test đỏ

`scripts/test-room-pairing.mjs:107` tạo thiết bị với nhãn `ESP32`, rồi kỳ vọng ghép với học sinh có MSSV `00` sẽ trả 200. Backend hiện trả 409 với `STUDENT_CODE_MISMATCH` đúng theo guard đang có trong `Quiz.bind()`.

Đã chạy bản chẩn đoán tạm, giữ nguyên assertion, chỉ thêm log status/code và điều chỉnh đường dẫn import để chạy trong `/tmp`. Phản hồi thực tế: `{"status":409,"code":"STUDENT_CODE_MISMATCH"}`. Đây là lỗi có trước refactor, không phải lỗi mở localhost. Không sửa fixture hoặc bỏ guard để làm test xanh; cần chốt kỳ vọng nghiệp vụ trước khi cập nhật bài test này.

## B. Những thay đổi đã thực hiện

| Nhóm / file | Thay đổi và lý do | Ảnh hưởng |
| --- | --- | --- |
| `server/app.ts`, `server/http-errors.ts` (mới) | Tách middleware lỗi thành hàm bốn tham số có tên; thay cast `Row` bằng shape lỗi cụ thể | Dễ đọc/test hơn; giữ nguyên vị trí middleware, thứ tự ưu tiên status/code, message, fieldErrors, requestId, Retry-After và logging |
| `scripts/test-http-errors.mjs` (mới) | Bảy test cho nhận diện middleware Express, Zod, SQLite constraint, parser/upload, rate limit/details, ẩn lỗi nội bộ và lỗi AI | Chỉ kiểm tra contract; không mở listener, database hoặc gọi AI |
| `client/src/pages/manage.tsx`, `client/src/quiz-config.tsx` (mới), `client/src/pages/session.tsx` | Tách ConfigFields/readConfig; dùng `Partial<Config>` và form entry types; session import trực tiếp module riêng, manage giữ re-export cũ | Giảm phụ thuộc giữa các trang; giữ nguyên JSX, default values và cách chuyển đổi form |
| `shared/protocol.ts`, `server/study-guide.ts`, `client/src/pages/study-plan.tsx` | Dùng chung Choice/QuestionOptionKey/StudyGuide; khai báo type chính xác cho review deck và kết quả AI; bỏ cast key giả `option_a` | TypeScript kiểm tra chặt hơn; không thay schema, prompt, retry hoặc cách render |
| `client/src/api.ts` | Khai báo ApiError/ApiErrorResponse; nhận JSON dưới dạng unknown và cast tại nhánh tương ứng | Giữ nguyên request, CSRF, upload, sign-out và nội dung lỗi; đây không phải bổ sung runtime validation |
| `docs/REFACTOR_PHASE_1.md` (mới) | Ghi lại khảo sát, phạm vi, chứng cứ và giới hạn kiểm thử | Tài liệu review |

Không thay `Row`/`Data` toàn repository hoặc default generic `api<T = any>` vì cần rà soát contract từng endpoint trước. Không thêm dependency hoặc abstraction cho nghiệp vụ.

## C. Kiểm thử

### Lệnh và kết quả

`npm run typecheck` chạy TypeScript frontend và backend: pass ban đầu, sau mỗi nhóm và ở trạng thái cuối. `npm run build`: pass trước và sau refactor trên Linux/WSL, bao gồm frontend bundle và backend compilation.

Tám script dưới đây được chạy riêng theo tiến trình, trước và sau refactor, qua runner tạm `/tmp/smartclass-phase1-tests.mjs`. Lệnh runner trả exit code 1 nếu có test thất bại; không bỏ qua assertion.

| Lệnh | Trước | Sau |
| --- | --- | --- |
| `node scripts/test-registration.mjs` | PASS | PASS |
| `node scripts/test-device-results.mjs` | PASS | PASS |
| `node scripts/test-class-deletion.mjs` | PASS | PASS |
| `node scripts/test-session-deletion.mjs` | PASS | PASS |
| `node scripts/test-device-rename.mjs` | PASS | PASS |
| `node scripts/test-room-pairing.mjs` | FAIL tại dòng 107 | FAIL cùng assertion |
| `node scripts/test-student-room-pairing.mjs` | PASS | PASS |
| `node scripts/test-student-web.mjs` | PASS | PASS |
| `node scripts/test-http-errors.mjs` (mới) | Chưa tồn tại | PASS, 7/7 test cases |

Tổng kết: 7/8 script hiện có pass trước và sau. Tính thêm script mới: 8/9 script pass ở lần chạy cuối. Student-web xác minh scoped tickets, ownership/origin/CSRF, answer ACK trùng, pause/deadline, restart/reconnect và điểm cá nhân. Device-results xác minh điểm và việc loại câu void/pending.

Các test HTTP/WebSocket lần đầu bị `listen EPERM` trong sandbox. Đã chạy lại với quyền mở localhost được cho phép; các lỗi EPERM này không còn là giới hạn ở lần chạy cuối. SQLite chỉ dùng `:memory:` hoặc database trong thư mục test mới dưới `/tmp`; test tự dọn đúng thư mục tạm của nó. Không mở database thật, không đọc `.env` qua các test, không chạy server production.

### Kiểm tra tương đương và diff

- Thân middleware sau khi xóa TypeScript types khớp thân hàm trong baseline, bỏ qua whitespace.
- ConfigFields: HTML do React server renderer tạo giống hệt baseline với bốn cấu hình (default, partial/empty, giới hạn nhỏ và lớn). readConfig cho kết quả giống nhau với bốn form, gồm trường thiếu và chuỗi số không hợp lệ.
- API client: 11 fixtures so sánh request, headers/body, response/error, redirect và auth broadcast trước/sau; pass. Bao gồm JSON/upload, 401, 422, 500, JSON hỏng/null, lỗi mạng và body falsy.
- JavaScript transpile của `shared/protocol.ts`, `server/study-guide.ts` và `client/src/pages/study-plan.tsx` giống baseline, xác nhận các chỉnh sửa chỉ là types.
- `git diff --check`: pass. Rà soát diff không thấy thay đổi database/schema, chấm điểm, realtime, firmware, CSS, dependency hoặc secrets. Các kiểm tra so sánh tạm không được thêm vào dependency/test scripts của project.

### Chưa xác minh / rủi ro còn lại

- `test-room-pairing` vẫn đỏ. Các đoạn phía sau assertion, bao gồm phần bài test 50 WebSocket, full room restart/Excel và rate-limit cuối bài, chưa chạy đến trong bài test này.
- Chưa chạy E2E trình duyệt tương tác toàn bộ UI, test OpenRouter thật, build Windows native hoặc kiểm thử ESP32 phần cứng. HTML comparison không thay thế các kiểm tra này.
- Các vấn đề logic, pairing, async và security nêu ở A vẫn còn; chúng nằm ngoài phạm vi sửa Giai đoạn 1.
- Các file lớn vẫn còn nhiều trách nhiệm. Refactor tiếp phải chia nhỏ và có kiểm thử theo từng module, không suy ra hệ thống an toàn tuyệt đối từ các test đã pass.

## D. Đánh giá compatibility

| Contract / thành phần | Kết luận trong phạm vi diff |
| --- | --- |
| API | Không đổi route, method, payload, response hoặc error contract |
| WebSocket | Không đổi message format, ACK, seq, request_id, version hoặc deadline; shared runtime schemas không đổi |
| SQLite | Không đổi schema/tên bảng/cột/migrations; không migrate database thật |
| Chấm điểm | Không sửa Quiz hoặc leaderboard; các test điểm hiện có vẫn pass |
| Firmware | Không sửa source/config/GPIO; chưa xác minh trên phần cứng |
| UI/UX | Không sửa CSS, nội dung, bố cục hoặc workflow; form render so sánh giống baseline |

Không tạo commit, push, cài/nâng dependency, audit fix, sửa `.env`, đổi/thu hồi secret hay triển khai.

## E. Đề xuất tiếp theo

| Giai đoạn | Ưu tiên và phạm vi | Rủi ro / điều kiện |
| --- | --- | --- |
| 1 — nghiệm thu | Chốt kỳ vọng của test-room-pairing và bổ sung xác minh các nhánh chưa chạy | Cần xác nhận MSSV phải khớp tuyệt đối hay cho phép teacher rebind khác MSSV. Chưa tự cập nhật fixture hoặc production guard |
| 2 — logic/dữ liệu | Regression tests cho async response, packet flashcard cũ, guard hoạt động, simulator và response time import | Vừa/cao. Chốt quy tắc MSSV và pairing trước; sửa protocol phải đánh giá tương thích firmware |
| 3 — realtime/SQLite | Đo snapshot/report/broadcast, sau đó mới xét cache/index/backpressure | Vừa. Cần benchmark và xác minh invalidation; chưa thêm cache/index |
| 4 — firmware | Xác minh thiết bị hiện tại, reconnect/retry và kết nối bảo mật trên phần cứng | Cao. Cần môi trường test ESP32 và xác minh protocol |
| 5 — security/build | Xử lý credential nghi lộ riêng, chính sách mật khẩu/danh tính; xác minh advisory; nối build helper cross-platform | Cao cho auth/secret/dependency, thấp cho copy build assets. Đề xuất chủ sở hữu thu hồi credential nghi lộ và thay example bằng placeholder trong công việc được phép riêng; không tự xoay vòng |

Dừng tại đây. Chưa đủ điều kiện tuyên bố Giai đoạn 1 đã hoàn thành hoặc hệ thống đã được kiểm chứng toàn diện.
