# Pipeline: hoàn thiện phần AI củng cố kiến thức

Ngày: 2026-10-14. Nền tảng: Gemini chính + OpenRouter dự phòng đã chạy (xem `PLAN_ESP32_ONLINE_QUA_TAILSCALE.md` Phần B).
Mục tiêu: lời giải AI **được lưu**, **kiểm soát được**, **đến được tay học sinh**, và **không vượt hạn mức**.

## Hiện trạng (đã đọc code)

| Thành phần | Vị trí | Ghi chú |
| --- | --- | --- |
| Route tạo gợi ý | `server/app.ts` `POST /api/sessions/:id/study-guide` | Không lưu kết quả; mỗi lần mở lại phải gọi AI |
| Gọi AI | `server/study-guide.ts` `createStudyGuide()` | Trả `explanations` + `practice` (cố định 3 câu), không trả model đã dùng |
| Giao diện | `client/src/pages/study-plan.tsx` | Nút bị khóa sau khi có kết quả; kết quả mất khi đổi học sinh |
| Tạo bộ thẻ ôn | `POST /api/sessions/:id/review-deck` | Chỉ từ câu sai của đề, chưa gồm câu AI soạn |
| Test chống đua | `scripts/test-study-plan-race.mjs` | Khóa payload `{student_id}` và số request; **không được phá** |

## Quyết định đã chốt

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| Nơi giao câu luyện thêm cho học sinh | Bộ flashcard + link tự học `/study/<mã>` có sẵn | Tái dùng hạ tầng, học sinh không cần tài khoản |
| Nạp lời giải đã lưu vào giao diện | Nhúng `study_guides` vào phản hồi `GET /api/sessions/:id/report` | Không thêm request mới, test chống đua giữ nguyên |
| Payload mặc định | Giữ `{ student_id }`; chỉ thêm `regenerate`, `lang`, `practice_count` khi khác mặc định | Không phá test hiện có |
| Tên bộ thẻ luyện thêm | Không chứa tên/MSSV học sinh | Link công khai; bộ thẻ có thể bị chia sẻ |
| Hạn mức | `AI_DAILY_LIMIT` theo giáo viên (mặc định 100/ngày, đếm trong bộ nhớ) | Tránh chạm quota Gemini giữa buổi |
| Vô hiệu bản lưu | Xóa bản lưu của buổi khi loại câu (void) | Báo cáo đổi thì lời giải cũ có thể sai |

## Các giai đoạn

### G1. Lưu trữ
1. Migration `009_study_guides.sql`: bảng `study_guides(session_id, student_id, payload, provider, model, lang, created_at)`, khóa chính `(session_id, student_id)`, xóa theo buổi và theo học sinh.
2. `createStudyGuide()` trả thêm `provider`, `model`.
3. Route `study-guide`: nếu đã lưu và không `regenerate` thì trả bản lưu (`cached: true`), kể cả khi AI chưa cấu hình; nếu không thì gọi AI, lưu rồi trả.
4. Xóa bản lưu của buổi khi `void` một câu.
5. Nhúng `study_guides` vào phản hồi báo cáo.

**Đạt khi:** gọi lần 2 không phát sinh request tới AI; `regenerate` ghi đè; void xóa bản lưu.

### G2. Tùy chọn và hạn mức
1. Tham số `practice_count` (1–5, mặc định 3) và `lang` (`vi`|`en`, mặc định `vi`); prompt theo hai tham số này, cắt thừa nếu model trả nhiều hơn.
2. Hạn mức `AI_DAILY_LIMIT` theo giáo viên; vượt thì `429 AI_DAILY_LIMIT` với thông báo rõ. Tạo lại cũng tính. Bản lưu trả về không tính.
3. Ghi vào `.env.example` và `docs/RUNBOOK.md`.

**Đạt khi:** test chứng minh prompt chứa số câu/ngôn ngữ đã chọn, và lần vượt hạn mức không gọi AI.

### G3. Giao cho học sinh
1. Route `POST /api/sessions/:id/study-guide/deck` `{ student_id }`: tạo bộ thẻ từ `practice` đã lưu (mặt trước: câu hỏi + 4 lựa chọn; mặt sau: đáp án + lời giải), bật link chia sẻ; lỗi `NO_GUIDE` (409) nếu chưa có bản lưu.
2. Tên bộ thẻ không chứa tên/MSSV.

**Đạt khi:** link `/api/public/flashcards/<token>` trả đúng số thẻ và không lộ tên học sinh.

### G4. Giao diện giáo viên
1. Hiển thị bản lưu khi chọn học sinh (không gọi lại AI).
2. Dòng thông tin: model đã dùng, thời điểm tạo.
3. Nút **Tạo lại**; chọn số câu luyện thêm; nút **Tạo link luyện thêm cho học sinh** kèm nút chép link.
4. Dòng cảnh báo "AI có thể sai; kiểm tra trước khi dùng với lớp".
5. Mọi chuỗi mới qua `t()` kèm bản EN; `npm run test:i18n` phải sạch.
6. `scripts/test-study-plan-race.mjs` vẫn 30/30.

### G5. Kiểm thử và hoàn tất
1. Test mới `scripts/test-study-guide-store.mjs` (tích hợp, `fetch` giả): lưu, cache, tạo lại, void xóa, tùy chọn trong prompt, hạn mức, bộ thẻ không lộ tên, chủ sở hữu khác không đọc được.
2. Chạy lại: `typecheck`, `build`, toàn bộ `scripts/test-*.mjs` (trừ hai test firmware thiếu ArduinoJson).
3. Gọi Gemini thật một lần qua route (khóa trong `.env`, không in ra).
4. Cập nhật tài liệu, commit theo giai đoạn, push.

## Rủi ro

| Rủi ro | Cách xử lý |
| --- | --- |
| Phá test chống đua | Payload mặc định giữ nguyên; không thêm request nạp bản lưu |
| Bản lưu cũ sau khi sửa báo cáo | Xóa khi void; nút Tạo lại |
| Link luyện thêm bị chia sẻ rộng | Tên bộ thẻ không có danh tính; giáo viên có thể tắt link ở trang bộ thẻ |
| Đếm hạn mức mất khi khởi động lại | Chấp nhận; ghi rõ là trong bộ nhớ |
| Quá tải Gemini | Đã có chuỗi model và OpenRouter dự phòng |

## Ngoài phạm vi
Học sinh làm lại và hệ thống ghi đúng/sai theo dõi tiến bộ (cần màn hình làm bài riêng); tạo gợi ý cho cả nhóm yếu theo chủ đề; xuất Excel/PDF theo ngôn ngữ.

## Kết quả thực hiện (2026-10-14)

| Giai đoạn | Kết quả |
| --- | --- |
| G1 Lưu trữ | Xong: `009_study_guides.sql`, bản lưu theo học sinh, trả `provider`/`model`, nhúng vào báo cáo, xóa khi loại câu |
| G2 Tùy chọn, hạn mức | Xong: `practice_count` 1–5, `lang`, `AI_DAILY_LIMIT` |
| G3 Giao cho học sinh | Xong: `POST /api/sessions/:id/study-guide/deck`, tên bộ thẻ không lộ danh tính |
| G4 Giao diện | Xong: bản lưu, model + thời điểm, Tạo lại, chọn số câu, link luyện thêm, cảnh báo |
| G5 Kiểm thử | `test-study-guide-store` 7/7; 21 script pass (trừ 2 test firmware thiếu ArduinoJson); `test-study-plan-race` vẫn 30/30; Gemini thật: lần 1 3,3 s, lần 2 `cached`, tạo bộ thẻ 3 thẻ |

Chưa làm (ngoài phạm vi): học sinh làm lại câu luyện thêm và ghi đúng/sai; tạo gợi ý cho cả nhóm yếu theo chủ đề; hạn mức lưu bền qua khởi động lại.
