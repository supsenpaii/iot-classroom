# Báo cáo bug và cách sửa — 2026-10-13

Phạm vi: toàn bộ ứng dụng sau Phần A (`/device`), B (Gemini + OpenRouter dự phòng) và C (VI/EN).
Nhánh/commit khi kiểm: `publish-20261001` @ `0b1a64a` cộng các thay đổi chưa commit của pipeline.
Môi trường: Node 24.21.0, Chromium headless (Playwright 1243), cơ sở dữ liệu tạm, **không** dùng `data/*.sqlite` thật.
Quy tắc: bước này **chỉ phát hiện và ghi lại**; chưa sửa code ứng dụng.

## 1. Kết quả test tự động

| Lệnh | Kết quả | Thời gian | Ghi chú |
| --- | --- | --- | --- |
| `npm run typecheck` | PASS | ~6 s | |
| `npm run build` | PASS | ~8 s | |
| `test-device-ui` (mới) | PASS 9/9 | <1 s | máy trạng thái `/device` |
| `test-study-guide-provider` (mới) | PASS 10/10 | <1 s | Gemini → OpenRouter, 429, rò key |
| `test-i18n` (mới) | PASS 5/5 | <1 s | khoảng 1.030 khóa, 0 thiếu |
| `test-student-web` | PASS | 1 s | |
| `test-room-pairing`, `test-registration`, `test-student-room-pairing`, `test-student-code`, `test-device-*` (4), `test-esp32-simulator`, `test-class-deletion`, `test-session-deletion`, `test-flashcard-replay`, `test-activity-guards`, `test-http-errors`, `test-room-pairing-ui` | PASS | ≤3 s mỗi bài | |
| `test-study-plan-race` | PASS 30/30 | 2 s | cần Chromium có `--no-sandbox` (BUG-009) |
| `test-student-code-ui` | PASS 18/18 | 2 s | như trên |
| `test-oled-display` | **KHÔNG CHẠY ĐƯỢC** | 0 s | thiếu `ArduinoJson.h` (BUG-010) |
| `test-firmware-recovery` | **KHÔNG CHẠY ĐƯỢC** | 0 s | thiếu `ArduinoJson.h` (BUG-010) |

Tổng: 20/22 script PASS; 2 script firmware không biên dịch được trên máy này vì thiếu thư viện. `pio run` không chạy (không có PlatformIO).

## 2. Kiểm thử thủ công / bán tự động đã làm

Bằng Chromium headless và API/WebSocket thật, trên server dựng tạm:

- Luồng `/device` đầy đủ: nhập mã sai, MSSV không có trong danh sách, vào phòng, thử nút ở phòng chờ, trả lời, phím vật lý, tạm dừng, kết thúc, xem điểm, rời phòng.
- Khởi động lại server giữa buổi (RUNNING): thiết bị nối lại sau ~1,8 s; buổi chuyển PAUSED; đáp án B được giữ; sau tiếp tục vẫn thấy `SAVED: B`.
- Bấm nhanh 8 phím liên tiếp: kết quả cuối khớp phím cuối, chỉ một dòng đáp án trong CSDL.
- Đồng hồ máy học sinh lệch +90 giây: đếm ngược theo giờ server (55 s so với 55 s).
- Tải lại trang giữa câu: tự vào lại đúng trạng thái.
- 17 trang × VI/EN × 390/1366 px (và 768 px chế độ tối): chụp ảnh `test-results/i18n/`, đo tràn ngang.
- 40 kịch bản biên qua API: mật khẩu, MSSV, nhập 500/501 dòng, file 6 MB, file hỏng, câu hỏi, cấu hình buổi, lệnh sai phiên bản, ROOM ID, khảo sát, điểm danh, bộ thẻ rỗng, token công khai sai, xuất Excel.
- Gemini thật bằng khóa trong `.env` (qua đường API `/api/sessions/:id/study-guide`): **thành công sau 8,8 s** với 1 câu sai, 3 câu luyện thêm. `gemini-3.8-flash` trả HTTP 503 "high demand" ở cả hai lần thử; chuỗi dự phòng chuyển sang `gemini-3.1-flash-lite` và thành công.
- `db:migrate`, `db:backup`, `db:restore --confirm-replace`: chạy đúng; file backup hỏng bị từ chối (xem BUG-012).

**Chưa kiểm** (nói rõ để không hiểu nhầm là đã đạt): chạy liên tục 30 phút (rò rỉ tài nguyên); 50 WebSocket đồng thời ngoài những gì `test-room-pairing` đã bao; ngắt mạng thật ở tầng WebSocket (giả lập `offline` của Chromium không đóng WebSocket đang mở, nên kết quả không có giá trị); Tailscale Funnel thật; ESP32 phần cứng thật; trình đọc màn hình; zoom 200%.

## 3. Đối chiếu báo cáo cũ `BAO_CAO_RA_SOAT_BUG_WEB_2026-09-29.md`

| Mã cũ | Nội dung | Trạng thái hiện tại |
| --- | --- | --- |
| B01 | Hết giờ không sang câu | Còn là cấu hình: `auto_next` mặc định `false` (`shared/protocol.ts:27`); sau khởi động lại buổi ở PAUSED là đúng thiết kế |
| B02 | Không xóa được thiết bị | Đã sửa: có `DELETE /api/devices/:id` (`server/app.ts:931`) |
| B03 | Tab khác giữ dữ liệu sau đăng xuất | Có cơ chế `BroadcastChannel` ở `client/src/api.ts`; chưa tái hiện lại |
| B04 | Trùng nhãn thiết bị | Đã sửa: mã `DUPLICATE_LABEL`, "Nhãn thiết bị đang được sử dụng" |
| B05 | "Bấm thử" được ACK khi RUNNING | Đã sửa: trả `INVALID_STATE` (`server/realtime.ts` nhánh `button.test`) |
| B06 | `npm run lint` quét nhầm `artifacts/` | Không còn script `lint` trong `package.json` |

---

## 4. Bug

### BUG-001 · Cao · Bảo mật · Mật khẩu giáo viên 1 ký tự vẫn được chấp nhận
- Cách tái hiện: 1) `POST /api/auth/register` với `{"email":"a@example.test","password":"short"}`. 2) Tương tự với 1 ký tự khi đổi mật khẩu.
- Kết quả thực tế: `201 Created`; tài khoản tạo xong. Thử 5 ký tự và 11 ký tự đều qua.
- Kết quả mong đợi: từ chối mật khẩu ngắn (hướng dẫn demo `HUONG_DAN_CHAY_DEMO.md` ghi ≥ 12 ký tự).
- Bằng chứng: probe API ngày 2026-10-13, `register pw(5): 201`, `register pw(11): 201`.
- Nguyên nhân (đã xác minh): `server/app.ts:141` (đăng ký) và `server/app.ts:405` (đổi mật khẩu) dùng `z.string().min(1).max(200)`.
- Cách sửa đề xuất: `min(12)` ở hai chỗ, thông báo "Mật khẩu cần ít nhất 12 ký tự"; hiển thị lỗi theo trường (liên quan BUG-002). Ước lượng: **S**. Đăng nhập giữ `min(1)` để tài khoản cũ còn vào được.
- Cách kiểm chứng sau sửa: thêm ca vào `scripts/test-registration.mjs`: 11 ký tự → 422, 12 ký tự → 201.
- Trạng thái: Đã sửa 2026-10-14: `min(12)` ở đăng ký và đổi mật khẩu, thêm `minLength` ở form; `test-registration` có ca 11 ký tự → 422

### BUG-002 · Trung bình · Giao diện · Lỗi nhập liệu không nói trường nào sai
- Cách tái hiện: 1) Trang ngân hàng câu hỏi, nhập câu hỏi dài 2001 ký tự và lưu. 2) Hoặc nhập MSSV có chữ khi nhập danh sách học sinh.
- Kết quả thực tế: thông báo "Dữ liệu chưa hợp lệ", không kèm trường.
- Kết quả mong đợi: chỉ ra trường và lý do ("Câu hỏi dài tối đa 2000 ký tự").
- Bằng chứng: API trả `422` kèm `fieldErrors[0].message = "Quá lớn: mong đợi string có <=2000 ký tự"` nhưng UI chỉ hiện câu chung.
- Nguyên nhân (đã xác minh): `server/http-errors.ts:52` thay `message` bằng câu chung; `client/src/api.ts` gán `error.details` rồi không trang nào đọc.
- Cách sửa đề xuất: trong `api.ts`, nếu `res.status === 422` và có `fieldErrors[0]`, ghép "{message chung}: {tên trường} — {thông điệp}". Ước lượng: **S**. Cần ánh xạ tên trường (`question` → "Câu hỏi") bằng bảng nhỏ.
- Cách kiểm chứng sau sửa: test giao diện kiểm câu hiển thị; xem T-001 trong báo cáo văn bản.
- Trạng thái: Mới

### BUG-003 · Trung bình · Giao diện · Trang phòng kiểm tra tràn ngang ở 768 px
- Cách tái hiện: 1) Mở `/sessions/<id>` ở cửa sổ 768 px rộng (máy tính bảng ngang), cả sáng và tối. 2) Cuộn ngang xuất hiện, tràn 50 px.
- Kết quả thực tế: `scrollWidth - innerWidth = 50`; khối "ROOM ID" bị cắt.
- Kết quả mong đợi: không có thanh cuộn ngang.
- Bằng chứng: `test-results/i18n/dark-768_sessions_*.png`; phần tử vượt: `.pairing-roster` (phải = 818 px so với 768 px).
- Nguyên nhân (đã xác minh): `client/src/styles.css:2812` `.pairing-layout` yêu cầu tối thiểu `260px + 300px + 24px` (584 px), nhưng vùng nội dung ở 768 px (trừ thanh bên 190 px) chỉ khoảng 520 px.
- Cách sửa đề xuất: thêm `@media (max-width: 900px) { .pairing-layout { grid-template-columns: 1fr; } }`. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: chạy lại `tour.mjs` hoặc đo `scrollWidth` ở 768 px.
- Trạng thái: Đã sửa 2026-10-14: `.pairing-layout` một cột dưới 900 px (`styles.css`)

### BUG-004 · Trung bình · Đa ngôn ngữ · Đổi ngôn ngữ tải lại cả trang
- Cách tái hiện: 1) Mở form sửa câu hỏi, gõ dở nội dung. 2) Bấm `VI|EN`.
- Kết quả thực tế: trang tải lại, mất nội dung đang gõ; ở `/student` đang trong bài thì màn hình nháy.
- Kết quả mong đợi: giữ nguyên trạng thái form.
- Nguyên nhân (đã xác minh): thiết kế có chủ đích của `client/src/i18n.tsx` (`window.location.reload()`), để các nhãn cấp module (`stateLabel`, `eventLabel`…) không cần dịch lúc render.
- Cách sửa đề xuất: chuyển nhãn cấp module thành hàm (gọi `t()` lúc render), thêm `LangProvider` đổi `key` gốc cây React thay vì reload. Hoặc chỉ cảnh báo ("Trang sẽ tải lại") khi form đang sửa dở. Ước lượng: **M**.
- Cách kiểm chứng sau sửa: `test-i18n` + tour VI↔EN không reload.
- Trạng thái: Mới (đề xuất; xem mục 5)

### BUG-005 · Trung bình · Đa ngôn ngữ · Không có số ít/số nhiều trong EN
- Cách tái hiện: 1) Mở báo cáo buổi có 1 câu, chuyển EN.
- Kết quả thực tế: "1/4 students · all 1 questions", "1 responses", "1 cards".
- Kết quả mong đợi: "1 question", "1 response", "1 card".
- Nguyên nhân (đã xác minh): `t()` chỉ thay `{slot}`; chuỗi gốc tiếng Việt không có số nhiều (`client/src/i18n.tsx`).
- Cách sửa đề xuất: thêm `tn(n, one, other)` hoặc quy ước khóa `…|one`; áp dụng cho khoảng 25 chuỗi có `{length}`/`{count}`/`{n}`. Ước lượng: **M**.
- Cách kiểm chứng sau sửa: mở rộng `test-i18n` để kiểm các cặp số ít/số nhiều.
- Trạng thái: Mới

### BUG-006 · Trung bình · Đa ngôn ngữ · Trình duyệt tiếng Anh tự thấy giao diện tiếng Anh
- Cách tái hiện: 1) Học sinh có điện thoại đặt ngôn ngữ tiếng Anh mở `/student`.
- Kết quả thực tế: giao diện, thông báo và nút bằng tiếng Anh; lần đầu không biết có công tắc `EN|VI`.
- Kết quả mong đợi: lớp học Việt Nam hiện tiếng Việt cho đến khi người dùng chọn khác (tùy chính sách của bạn).
- Nguyên nhân (đã xác minh): quyết định đã chốt "mặc định theo trình duyệt" (`client/src/i18n.tsx` `detect()`); cũng khiến 2 test trình duyệt phải ghim `classroom-lang=vi`.
- Cách sửa đề xuất: nếu muốn mặc định tiếng Việt: trong `detect()` trả `"vi"` khi không có lựa chọn đã lưu. Ước lượng: **S** (một dòng).
- Cách kiểm chứng sau sửa: tour ở trình duyệt `en-US` sạch.
- Trạng thái: Đã sửa 2026-10-14: mặc định luôn tiếng Việt, chỉ EN khi người dùng chọn (`i18n.tsx`, `theme-init.js`)

### BUG-007 · Thấp · Thông báo · Xung đột phiên bản trả cả snapshot buổi trong `fieldErrors`
- Cách tái hiện: 1) `POST /api/sessions/:id/commands` với `expected_version: 0` khi buổi đã ở phiên bản khác.
- Kết quả thực tế: `409 VERSION_CONFLICT`, thân phản hồi chứa toàn bộ snapshot buổi (tên lớp, cấu hình, `room_code`) trong `fieldErrors`.
- Kết quả mong đợi: chỉ mã lỗi và phiên bản hiện tại.
- Bằng chứng: probe `stale version`.
- Nguyên nhân (đã xác minh): `server/quiz.ts:308` gắn snapshot vào `details`; `server/http-errors.ts` đưa `details` vào `fieldErrors`. Chỉ giáo viên chủ buổi thấy nên không phải lỗ hổng, nhưng thừa và gây khó đọc log.
- Cách sửa đề xuất: trả `{ code, state_version }`; giao diện tự gọi lại snapshot. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: `scripts/test-activity-guards.mjs` hoặc test lệnh phiên bản.
- Trạng thái: Mới

### BUG-008 · Thấp · Thiết bị ảo · Dòng OLED sau khi mất kết nối nhắc nhập lại MSSV
- Cách tái hiện: 1) Vào phòng bằng `/device`. 2) Ngắt server vài giây.
- Kết quả thực tế: `CONNECTING... / STUDENT ID + ENTER / SAVED: B`.
- Kết quả mong đợi: không gợi ý nhập lại khi đã vào phòng.
- Nguyên nhân (đã xác minh): `shared/device-screen.ts` `oledLines` sao chép đúng `drawOledStatus()` của firmware (`main.cpp:386-398`), vốn cũng như vậy.
- Cách sửa đề xuất: khi `joined && !live` hiện `RECONNECTING...` ở dòng 2 (cả firmware lẫn web). Ước lượng: **S**.
- Cách kiểm chứng sau sửa: `test-device-ui` thêm ca; với firmware cần `test-oled-display` (cập nhật mã băm vàng).
- Trạng thái: Mới

### BUG-009 · Thấp · Hạ tầng test · Test trình duyệt treo im lặng trên máy chặn sandbox Chromium
- Cách tái hiện: 1) Trên Linux có hạn chế user namespace, chạy `node scripts/test-study-plan-race.mjs`.
- Kết quả thực tế: không in lỗi, treo đến hết thời gian chờ (chạy 150 s rồi bị `timeout` giết); 30 test "FAIL" với `Cannot set properties of null` nếu chạy được đến cuối.
- Kết quả mong đợi: báo ngay "không khởi động được Chromium".
- Nguyên nhân (đã xác minh): `scripts/test-study-plan-race.mjs:126` và `scripts/test-student-code-ui.mjs:102` spawn Chromium không có `--no-sandbox`, và không kiểm tra tiến trình thoát sớm. Lỗi trùng với bản gốc (kiểm bằng `git worktree` ở `HEAD`).
- Cách sửa đề xuất: hỗ trợ `SMARTCLASS_TEST_CHROME_ARGS`; nếu `browser` thoát trước khi có `DevToolsActivePort`, `throw` kèm stderr. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: chạy trên máy chặn sandbox, có lỗi rõ.
- Trạng thái: Mới

### BUG-010 · Thấp · Hạ tầng test · Test firmware cần `ArduinoJson.h` nhưng không có hướng dẫn cài
- Cách tái hiện: `node scripts/test-oled-display.mjs`.
- Kết quả thực tế: `fatal error: ArduinoJson.h: No such file or directory`.
- Kết quả mong đợi: test chạy, hoặc bị bỏ qua có thông báo rõ.
- Nguyên nhân (đã xác minh): script biên dịch `main.cpp` bằng `g++` thật và cần thư viện từ PlatformIO (`lib_deps`).
- Cách sửa đề xuất: ghi trong `firmware/esp32-classroom/README.md` cách có thư viện (`pio pkg install` hoặc `-I` tới thư mục `.pio/libdeps`); script in "bỏ qua: thiếu ArduinoJson" khi không tìm thấy. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: chạy trên máy sạch.
- Trạng thái: Mới

### BUG-011 · Thấp · AI · `gemini-3.8-flash` hay quá tải; chuỗi mặc định tốn ~2 s mỗi lần
- Cách tái hiện: 1) Gọi tạo gợi ý AI nhiều lần trong ngày với mặc định `GEMINI_MODEL`.
- Kết quả thực tế: 4/5 lần thử `gemini-3.8-flash` trả 503 "This model is currently experiencing high demand"; `gemini-3.1-flash-lite` luôn thành công (5–8 s). `gemini-3.6-flash` cũng 503 nhiều lần.
- Kết quả mong đợi: thời gian chờ ổn định.
- Nguyên nhân (đã xác minh): tải của Google theo model; mặc định `DEFAULT_GEMINI_MODEL = "gemini-3.8-flash,gemini-3.1-flash-lite"` (`server/study-guide.ts`) thử model nặng trước, mỗi model thử hai lần khi 503.
- Cách sửa đề xuất: đổi thứ tự mặc định `gemini-3.1-flash-lite,gemini-3.8-flash`, hoặc chỉ thử 1 lần khi 503 và còn model khác. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: chạy `scripts/test-study-guide-provider.mjs` và một lần gọi thật.
- Trạng thái: Đã sửa 2026-10-14: mặc định `gemini-3.1-flash-lite,gemini-3.8-flash`

### BUG-012 · Thấp · Vận hành · Khôi phục file backup hỏng in nguyên stack trace
- Cách tái hiện: 1) `echo garbage > bad.sqlite`. 2) `node dist/server/scripts/admin.js restore bad.sqlite --confirm-replace`.
- Kết quả thực tế: stack trace của `better-sqlite3` (`pragma.js`), không có câu giải thích. Cơ sở dữ liệu hiện tại **không** bị thay (kiểm bằng lần restore hợp lệ ngay sau).
- Kết quả mong đợi: "File không phải cơ sở dữ liệu hợp lệ; chưa thay đổi gì."
- Nguyên nhân (nghi ngờ): `scripts/admin.ts` không bọc lỗi mở file.
- Cách sửa đề xuất: bọc kiểm tra `PRAGMA integrity_check` trong `try`, in thông báo ngắn. Ước lượng: **S**.
- Cách kiểm chứng sau sửa: chạy lại bước tái hiện.
- Trạng thái: Mới

### BUG-013 · Thấp · Tài liệu · `HUONG_DAN_CHAY_DEMO.md` lỗi thời
- Kết quả thực tế: ghi "chưa có firmware ESP32 thật trong repo" (hiện có `firmware/esp32-classroom`), "mật khẩu ≥ 12 ký tự" (máy chủ không ép, xem BUG-001), và chưa nhắc `/student`, `/device`.
- Cách sửa đề xuất: cập nhật hướng dẫn. Ước lượng: **S**.
- Trạng thái: Mới

---

## 5. Đề xuất (chưa hợp lý)

### SUG-001 · Mở nhận thiết bị bị đóng khi buổi chuyển RUNNING — học sinh vào muộn không có đường vòng
- Quan sát: sau khi bắt đầu, học sinh nhập đúng mã nhận `ROOM_UNAVAILABLE` ("Mã phòng sai, hết hạn hoặc đã đóng nhận thiết bị"). Muốn cho vào, giáo viên phải tạm dừng rồi mở nhận lại.
- Đề xuất: giữ nút "Mở nhận thiết bị" cạnh nút Tạm dừng, hoặc thông báo cho học sinh "Buổi đã bắt đầu. Nhờ giáo viên tạm dừng rồi mở phòng." Thông báo hiện tại không phân biệt "sai mã" và "đã đóng".
- Văn bản kèm: tách mã `ROOM_CLOSED` khỏi `ROOM_UNAVAILABLE` ở `server/pairing.ts:80,87`.

### SUG-002 · Chuỗi AI: hiển thị nhà cung cấp/model đã dùng
- Quan sát: giáo viên không biết lời giải đến từ Gemini hay OpenRouter; chỉ có log máy chủ.
- Đề xuất: trả thêm `provider`, `model` trong phản hồi `study-guide` và hiện nhỏ dưới tiêu đề.

### SUG-003 · Lưu lời giải AI (B5 chưa làm)
- Quan sát: kết quả không lưu CSDL, nên tải lại trang là mất và tốn thêm lượt gọi. Hiện đã có khóa chống gọi trùng cùng buổi.
- Đề xuất: bảng `study_guides(session_id, student_id, created_at, payload)`, tạo một lần cho mỗi học sinh/buổi.

### SUG-004 · `/device` v1 chỉ có quiz
- Quan sát: flashcard (A Nhớ / B Chưa nhớ), khảo sát nhanh, điểm danh chưa có trên thiết bị ảo. Học sinh không phần cứng vẫn bấm được qua `/student` cho quiz nhưng **không** cho các hoạt động còn lại.
- Đề xuất: giai đoạn sau của Phần A; máy trạng thái đã tách thuần nên mở rộng được.

### SUG-005 · Xuất báo cáo và đầu ra AI chưa theo ngôn ngữ (C-5)
- Quan sát: Excel/PDF và nội dung AI luôn tiếng Việt, dù giao diện đang EN.
- Đề xuất: truyền `lang` vào các route xuất và vào prompt AI.

---

## 6. Bảng tổng hợp

| Mức | Số | Mã |
| --- | --- | --- |
| Nghiêm trọng | 0 | |
| Cao | 1 | BUG-001 |
| Trung bình | 5 | BUG-002, 003, 004, 005, 006 |
| Thấp | 7 | BUG-007 … BUG-013 |
| Đề xuất | 5 | SUG-001 … SUG-005 |

| Nhóm chức năng | Bug |
| --- | --- |
| Tài khoản / bảo mật | BUG-001 |
| Giao diện | BUG-002, BUG-003 |
| Đa ngôn ngữ | BUG-004, BUG-005, BUG-006 |
| Backend / API | BUG-007 |
| Thiết bị ảo | BUG-008 |
| Hạ tầng test | BUG-009, BUG-010 |
| AI | BUG-011 |
| Vận hành | BUG-012 |
| Tài liệu | BUG-013 |

## 7. Việc nên sửa trước buổi dạy thật

1. **BUG-001**: đặt độ dài tối thiểu cho mật khẩu giáo viên (một dòng, rồi kiểm test đăng ký).
2. **Đổi `GEMINI_API_KEY`**: khóa từng được dán vào cuộc trò chuyện; tạo khóa mới tại aistudio.google.com/apikey rồi cập nhật `.env`.
3. **BUG-006**: quyết định ngôn ngữ mặc định cho học sinh (đang theo trình duyệt).
4. **BUG-003**: sửa tràn ở 768 px nếu dùng máy tính bảng.
5. **BUG-011**: đổi thứ tự model Gemini để chờ ngắn hơn.

## 8. Không có bí mật trong báo cáo

Báo cáo không chứa khóa API, bí mật thiết bị hay dữ liệu học sinh thật. Mọi MSSV và tên trong ảnh chụp là dữ liệu mẫu (`001`–`004`, "Học sinh 001").
