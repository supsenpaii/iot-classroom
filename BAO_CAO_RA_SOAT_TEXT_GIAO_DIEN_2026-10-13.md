# Báo cáo rà soát văn bản giao diện — 2026-10-13

Phạm vi: toàn bộ chuỗi trong `client/src` (khoảng 1.030 khóa `t("…")`) và thông báo lỗi từ `server/*.ts`, sau khi đã làm Phần A (`/device`), B (Gemini) và C (VI/EN).

Cách rà soát: đọc toàn bộ danh sách khóa; chụp màn hình các trang chính ở 390 / 768 / 1366 px, VI và EN (`test-results/i18n/`); quét DOM ở chế độ EN để tìm chữ Việt còn sót; đối chiếu bản dịch EN. Báo cáo này **không sửa chuỗi nào**; chỉ đề xuất.

Mức độ: **Cao** = gây hiểu sai hoặc lộ lỗi kỹ thuật; **Trung bình** = thiếu nhất quán/khó hiểu; **Thấp** = chính tả, tinh chỉnh.

## Tóm tắt

| Mức | Số mục |
| --- | --- |
| Cao | 3 |
| Trung bình | 11 |
| Thấp | 6 |

Kết quả quét tự động: ở chế độ EN, mọi dòng tiếng Việt còn lại trên 17 trang đều là **dữ liệu người dùng** (tên lớp, đề, câu hỏi, tên học sinh), đúng ý định. Không có chữ tràn ngang ở 390 px và 1366 px.

---

## Nhóm A. Lỗi kỹ thuật lộ ra người dùng / không đủ rõ

### T-001 · Mọi form · Lỗi nhập liệu chỉ ghi "Dữ liệu chưa hợp lệ"
- Vị trí: `server/http-errors.ts:52` (phát), `client/src/api.ts:52-60` (hiển thị; `error.details` không được dùng ở đâu cả)
- Hiện tại: "Dữ liệu chưa hợp lệ"
- Vấn đề: không nói trường nào sai, sai thế nào. Máy chủ đã gửi `fieldErrors` kèm thông điệp tiếng Việt (ví dụ "Quá lớn: mong đợi string có <=200 ký tự") nhưng giao diện bỏ đi.
- Đề xuất VI: ghép thông điệp trường đầu tiên: "Dữ liệu chưa hợp lệ: {tên trường} — {thông điệp}". Ví dụ "Dữ liệu chưa hợp lệ: câu hỏi dài tối đa 2000 ký tự."
- Đề xuất EN: "Some data is invalid: {field} — {message}." 
- Mức độ: **Cao**

### T-002 · Nhập file · "Parser đã dừng" và "row_type phải là ANSWER_KEY hoặc STUDENT"
- Vị trí: `server/imports.ts:47`, `server/imports.ts:110`
- Hiện tại: "Parser đã dừng"; "row_type phải là ANSWER_KEY hoặc STUDENT"
- Vấn đề: thuật ngữ kỹ thuật/tên cột nội bộ hiện ra trước giáo viên; không nói cách sửa.
- Đề xuất VI: "Không đọc được file. Hãy lưu lại dưới dạng .xlsx hoặc CSV UTF-8 rồi thử lại."; "Cột `row_type` chỉ nhận ANSWER_KEY (dòng đáp án đúng) hoặc STUDENT (dòng học sinh). Tải file mẫu để xem cách điền."
- Đề xuất EN: "Couldn't read the file. Save it as .xlsx or CSV (UTF-8) and try again."; "The `row_type` column must be ANSWER_KEY (the answer-key row) or STUDENT (a student row). Download the template to see how to fill it in."
- Mức độ: **Cao**

### T-003 · Nhập danh sách học sinh · "Dữ liệu trùng hoặc đang được sử dụng"
- Vị trí: `server/http-errors.ts:54` (mã `CONFLICT` bị nuốt thành câu chung)
- Hiện tại: "Dữ liệu trùng hoặc đang được sử dụng"
- Vấn đề: khi nhập học sinh có MSSV đã tồn tại trong lớp, giáo viên không biết MSSV nào trùng. Kiểm tra bằng API: nhập `00123` lần hai trả đúng câu này.
- Đề xuất VI: "Mã học sinh {mã} đã có trong lớp này."; với xóa/sửa: "Mục này đang được dùng ở buổi kiểm tra hoặc điểm danh nên không thể xóa."
- Đề xuất EN: "Student ID {id} is already in this class."; "This item is used by a quiz or attendance record and can't be deleted."
- Mức độ: **Cao**

---

## Nhóm B. Thuật ngữ không nhất quán

### T-004 · Toàn app · "phòng" / "buổi" / "bài" cho cùng một đối tượng
- Vị trí: `client/src/pages/session.tsx:84` ("PHÒNG KIỂM TRA"), `client/src/api.ts:105` ("Buổi đang tạm dừng"), `client/src/pages/student.tsx:57` ("Bài đang tạm dừng"), `client/src/student-client.ts:145` ("Bài đang được mở ở tab khác")
- Vấn đề: một buổi kiểm tra được gọi là phòng, buổi và bài.
- Đề xuất: giáo viên thấy **"buổi kiểm tra"**; học sinh thấy **"bài kiểm tra"**; "phòng" chỉ dùng cho nơi nhập **mã phòng**. Sửa "Bài đang tạm dừng" → "Buổi kiểm tra đang tạm dừng" (phía giáo viên), giữ "Bài kiểm tra đang tạm dừng" (phía học sinh).
- EN: quiz session (teacher) / quiz (student) / room code.
- Mức độ: Trung bình

### T-005 · Mã phòng: "Room ID" / "ROOM ID" / "Mã phòng"
- Vị trí: `client/src/pages/student.tsx:111` ("Room ID"), `client/src/pages/simulator.tsx:350,376` ("ROOM ID"), `server/pairing.ts:80,87` ("Mã phòng …")
- Vấn đề: nhãn ô nhập là "Room ID", thông báo lỗi là "Mã phòng sai…", nhãn firmware là "ROOM ID".
- Đề xuất VI: nhãn "Mã phòng (ROOM ID)" ở mọi nơi; thông báo lỗi giữ "Mã phòng …".
- Đề xuất EN: "Room code (ROOM ID)" lần đầu, sau đó "Room ID".
- Mức độ: Trung bình

### T-006 · MSSV và "Mã học sinh"
- Vị trí: `client/src/pages/manage.tsx:536,650` ("Mã học sinh"), `client/src/pages/student.tsx:28,109` ("MSSV")
- Vấn đề: cùng một khái niệm, hai tên. Trang lớp dùng "Mã học sinh", trang học sinh dùng "MSSV". Mã có thể không phải mã sinh viên (lớp phổ thông).
- Đề xuất VI: "Mã học sinh" ở cả hai nơi; câu hướng dẫn: "Nhập mã học sinh (MSSV)…".
- Đề xuất EN: "Student ID".
- Mức độ: Trung bình

### T-007 · "Giả lập" / "Thiết bị ảo" dễ nhầm
- Vị trí: `client/src/pages/simulator.tsx:341`, `client/src/pages/room-pairing.tsx:35`, `client/src/pages/device.tsx`
- Vấn đề: hai tính năng khác nhau (công cụ thử của giáo viên và thiết bị cho học sinh không có phần cứng) có tên gần giống nhau, hiện cạnh nhau ở khung ghép thiết bị.
- Đề xuất VI: "Giả lập thiết bị (giáo viên thử)" và "Thiết bị ảo (học sinh dùng trên điện thoại)".
- Đề xuất EN: "Device simulator (for teachers)" and "Virtual device (for students)".
- Mức độ: Trung bình

### T-008 · Độ khó trung bình: "Trung bình" và "Vừa"
- Vị trí: `client/src/pages/banks.tsx:27` ("Trung bình"), `client/src/pages/score-stats.tsx:20` ("Vừa")
- Vấn đề: cùng mức "medium" nhưng một nơi gọi "Trung bình", nơi khác "Vừa"; trong `score-stats.tsx` "Trung bình" lại còn là xếp loại học lực.
- Đề xuất VI: độ khó dùng "Dễ / Vừa / Khó" ở cả hai nơi; xếp loại học lực giữ "Trung bình".
- Đề xuất EN: Easy / Medium / Hard; grades: Excellent / Good / Average / Weak / Poor. (Hiện bản EN dùng "Average" cho cả hai.)
- Mức độ: Trung bình

### T-009 · Tên sản phẩm
- Vị trí: `client/src/main.tsx:277` ("SmartClass"), `client/src/pages/student.tsx:79` ("Lớp học tương tác"), `client/index.html:8` (`<title>SmartClass</title>`), README ("Lớp học tương tác ESP32")
- Vấn đề: ba tên cho một sản phẩm. Tab trình duyệt của giáo viên luôn là "SmartClass" cho mọi trang.
- Đề xuất: chọn một tên hiển thị; đặt `document.title` theo từng trang (ví dụ "Báo cáo · SmartClass").
- Mức độ: Thấp

---

## Nhóm C. Giọng văn và xưng hô

### T-010 · Khảo sát nhanh · mẫu câu hỏi xưng "em"
- Vị trí: `client/src/pages/polls.tsx:19` ("Em hiểu phần vừa học đến đâu?"), `client/src/pages/polls.tsx:29` ("Buổi học hôm nay em thấy thế nào?")
- Vấn đề: phần còn lại của giao diện học sinh dùng "bạn" ("Bạn đã vào phòng"); mẫu này dùng "em".
- Đề xuất VI: "Bạn hiểu phần vừa học đến đâu?"; "Hôm nay bạn thấy buổi học thế nào?". (Giáo viên vẫn sửa được câu hỏi.)
- Đề xuất EN: "How well do you understand what we just covered?"; "How did you find today's lesson?"
- Mức độ: Trung bình · **Đã sửa 2026-10-14**

### T-011 · Điểm danh · hướng dẫn giáo viên có "Em chưa gán…"
- Vị trí: `client/src/pages/attendance.tsx:48`
- Hiện tại: "…Em chưa gán thiết bị vẫn điểm danh tay được."
- Vấn đề: văn bản dành cho giáo viên nhưng xưng "em" như học sinh.
- Đề xuất VI: "Học sinh chưa gán thiết bị vẫn có thể điểm danh thủ công."
- Đề xuất EN: "Students without a device can still be marked manually."
- Mức độ: Trung bình · **Đã sửa 2026-10-14**

### T-012 · Hai câu gần giống cho cùng một tình huống
- Vị trí: `client/src/pages/student.tsx:76`, `client/src/student-client.ts:145`, `server/student.ts:43,96`
- Hiện tại: "Bạn đã được gỡ khỏi phòng hoặc quyền làm bài đã hết…" và "Quyền làm bài đã hết hoặc bạn đã được gỡ khỏi phòng…"
- Vấn đề: bốn biến thể của cùng một ý; học sinh thấy các câu khác nhau tùy chỗ.
- Đề xuất VI (một câu duy nhất): "Bạn không còn trong phòng này hoặc quyền làm bài đã hết. Hãy hỏi giáo viên."
- Đề xuất EN: "You're no longer in this room, or your access has ended. Ask your teacher."
- Mức độ: Trung bình · **Đã sửa 2026-10-14**

### T-013 · Hai thông báo cho "không đọc được phản hồi"
- Vị trí: `client/src/api.ts:46` ("Không đọc được phản hồi máy chủ. Thử lại sau."), `client/src/student-client.ts:16` ("Chưa đọc được phản hồi máy chủ. Hãy thử lại.")
- Đề xuất VI: dùng một câu: "Chưa đọc được phản hồi từ máy chủ. Hãy thử lại sau ít phút."
- Mức độ: Thấp · **Đã sửa 2026-10-14**

---

## Nhóm D. Viết tắt, câu bị cắt khúc, trình bày

### T-014 · Viết tắt "TG", "HS", "TB"
- Vị trí: `client/src/pages/score-stats.tsx:192` ("TB"), `:264` ("Phân loại HS"), `:265` ("TG trả lời")
- Đề xuất VI: "Phân loại học sinh", "Thời gian trả lời", "Điểm TB" → "Trung bình".
- Đề xuất EN: "Student grouping", "Response time", "Avg" (đã có).
- Mức độ: Thấp · **Đã sửa 2026-10-14 (TG, HS)**

### T-015 · Câu bị cắt thành nhiều khóa dịch (khó dịch đúng thứ tự từ)
- Vị trí: `client/src/pages/manage.tsx:1041,1047` ("Cần" + liên kết + "trước."), `client/src/pages/flashcards.tsx:164` ("…Học sinh bấm" + "A = Nhớ" + …), `client/src/pages/results-grid.tsx:100` ("học sinh · đủ … câu"), `client/src/pages/attendance.tsx:180` ("Có mặt {v}{v2}")
- Vấn đề: mỗi mảnh phải dịch riêng, nên EN phải ghép theo trật tự tiếng Việt ("You need to" + "create a class and students" + "first.").
- Đề xuất: viết thành một khóa nguyên câu, chèn liên kết bằng ký hiệu (ví dụ `Cần <link>tạo lớp và học sinh</link> trước.`) và để `t()` hỗ trợ thẻ đơn giản.
- Mức độ: Trung bình

### T-016 · Số ít/số nhiều trong EN
- Vị trí: mọi chuỗi có `{n} câu`, `{length} học sinh`, `{count} ý kiến`, `{length} thẻ`
- Vấn đề: bản EN hiện ra "1 questions", "1 students", "1 responses", "1 cards" (quan sát ở báo cáo buổi có 1 câu: "all 1 questions").
- Đề xuất: thêm hàm `plural(n, one, other)` hoặc khóa riêng cho số 1; hoặc dùng "question(s)".
- Mức độ: Trung bình

### T-017 · Dấu ngoặc kép không đồng nhất
- Vị trí: `client/src/components.tsx:29` (“…”), `client/src/pages/flashcards.tsx:397` ("…")
- Đề xuất: dùng cùng một kiểu “…” cho tên trong hộp thoại xác nhận.
- Mức độ: Thấp · **Đã sửa 2026-10-14**

### T-018 · Câu hỏi mẫu và số thập phân
- Vị trí: `client/src/pages/score-stats.tsx:13-17`
- Vấn đề: khoảng điểm viết "6,5 – 8" (dấu phẩy VI). Đã chuyển thành "6.5 – 8" ở EN. Cần chắc các chỗ khác trong biểu đồ cũng theo `locale()` (đã kiểm: `fmt()` dùng `locale()`).
- Mức độ: Thấp

### T-019 · Thiết bị ảo · dòng OLED khi mất kết nối
- Vị trí: `shared/device-screen.ts` (`oledLines`), firmware `main.cpp:drawOledStatus`
- Hiện tại: dòng 1 "CONNECTING...", dòng 2 "STUDENT ID + ENTER" kèm "SAVED: B"
- Vấn đề: đã vào phòng rồi mà dòng 2 vẫn nhắc nhập MSSV (giống firmware thật). Học sinh có thể tưởng phải nhập lại.
- Đề xuất: dòng 2 là "RECONNECTING..." khi đã vào phòng nhưng chưa có snapshot (cả firmware và web).
- Mức độ: Trung bình · **Đã sửa phía web 2026-10-14; firmware chưa đổi**

---

## Bảng thuật ngữ thống nhất (VI ↔ EN)

| Tiếng Việt (đề xuất) | English | Ghi chú |
| --- | --- | --- |
| lớp | class | |
| học sinh | student | |
| mã học sinh (MSSV) | student ID | một tên duy nhất |
| bộ đề | question set | |
| ngân hàng câu hỏi | question bank | |
| buổi kiểm tra | quiz session | phía giáo viên |
| bài kiểm tra | quiz | phía học sinh |
| mã phòng (ROOM ID) | room code (ROOM ID) | |
| phòng chờ | lobby | |
| thiết bị | device | ESP32 thật hoặc ảo |
| thiết bị ảo | virtual device | học sinh dùng trên điện thoại |
| giả lập thiết bị | device simulator | giáo viên thử |
| ghép thiết bị / gỡ ghép | pair / unpair | |
| điểm danh | attendance | |
| khảo sát nhanh | quick poll | |
| thi đua / bảng xếp hạng | leaderboard | |
| màn hình chiếu | projector view | |
| gợi ý ôn tập | study suggestions | |
| Dễ / Vừa / Khó | Easy / Medium / Hard | độ khó |
| Giỏi / Khá / Trung bình / Yếu / Kém | Excellent / Good / Average / Weak / Poor | xếp loại |

## Chuỗi nên xóa hoặc gộp

| Khóa hiện tại | Hành động |
| --- | --- |
| "Chưa đọc được phản hồi máy chủ. Hãy thử lại." / "Không đọc được phản hồi máy chủ. Thử lại sau." | Gộp một |
| 4 biến thể "gỡ khỏi phòng / quyền làm bài đã hết" | Gộp một (T-012) |
| "Giả lập không khả dụng" (server) / "Giả lập đã tắt trên môi trường này." (client) | Gộp một |
| Các mảnh "Cần" / "tạo lớp và học sinh" / "trước." | Thành một khóa (T-015) |
| Các khóa chứa `{v}`, `{v2}`, `{v3}` | Đổi tên tham số có nghĩa (`{time}`, `{note}`) để người dịch hiểu |

## Giới hạn của lần rà soát này

- Chưa soát nội dung Excel/PDF xuất ra (Phần C-5 chưa làm) và nội dung do AI sinh (luôn tiếng Việt).
- Chưa kiểm tra bằng trình đọc màn hình thật; chỉ đối chiếu `aria-label`, `title`.
- Bản dịch EN là bản nháp, chưa qua người bản ngữ.
