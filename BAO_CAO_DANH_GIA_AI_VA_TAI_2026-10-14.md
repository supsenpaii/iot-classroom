# Đánh giá chất lượng AI và khả năng chịu tải — 2026-10-14

Tự chạy, không cần thiết bị thật. Khóa Gemini lấy từ `.env`, không in ra. Dữ liệu là câu hỏi mẫu (GPIO, mạng, toán, vật lí, lập trình, sinh học), không có học sinh thật.

## 1. Chất lượng lời giải AI

**Cách đo:** 6 lượt gọi qua `createStudyGuide()` trên 20 câu sai/bỏ trống (22 lời giải, 18 câu luyện thêm), model `gemini-3.1-flash-lite`, mỗi lượt 2,2–3,5 s.

| Tiêu chí | Kết quả |
| --- | --- |
| Có đủ một lời giải cho mỗi câu | 22/22 |
| Nêu đúng lựa chọn học sinh đã chọn ("Đã chọn X…") | 100% |
| Có mẹo nhớ ở cuối | 22/22 |
| Lời khuyên chung chung ("cần củng cố…") | 0 |
| Độ dài trung bình | 3,0 câu; không câu nào quá dài hay quá ngắn |
| Câu luyện thêm trùng đề gốc (độ giống > 0,75) | 0/18 |
| Lựa chọn lộ đáp án ("đúng", "chính xác") hoặc lặp | 0 |
| Kiểm tra tay các bài toán (3²+4², 2x+6=14, diện tích, %) | đúng cả |

**Vấn đề tìm thấy và đã sửa:**

| # | Vấn đề | Cách sửa | Kết quả sau sửa |
| --- | --- | --- | --- |
| 1 | Đáp án đúng của câu luyện thêm lệch: A 7, B 6, C 5, **D 0** | `balancePractice()` xoay vị trí đáp án đúng (hoán đổi nội dung lựa chọn), bỏ qua nếu lời giải nhắc tới chữ cái | A 4, B 7, C 5, D 2 trên 18 câu; test chứng minh 4 câu → 4 chữ cái khác nhau |
| 2 | AI khẳng định nguyên nhân sai như sự thật ("là nhầm vì đã tính chu vi…") | Prompt yêu cầu dùng "có thể do", "thường do" | 7/20 lời giải đã dùng từ thận trọng; phần còn lại nêu lỗi sai khái quát |
| 3 | Câu bỏ trống bị gán lý do ("do chưa nắm rõ vai trò…") | Prompt: chỉ ghi "Câu này đã bỏ trống." rồi giải thích đáp án | 2/2 câu bỏ trống xử lý trung tính |

**Còn hạn chế:**
- Chỉ kiểm bằng 20 câu tự soạn, chưa phải đề thật của bạn; đề chuyên sâu (văn học, ngoại ngữ) chưa thử.
- Câu luyện thêm thường chỉ đổi số liệu/ngữ cảnh. Đúng với yêu cầu prompt, nhưng với chủ đề khái niệm có thể muốn đa dạng hơn.
- Phân bố đáp án chưa đều tuyệt đối vì bỏ qua câu có nhắc chữ cái trong lời giải.
- Việc đọc kiểm trên đề thật vẫn nên do giáo viên làm trước khi dùng cho lớp.

## 2. Tải và độ ổn định

**Cách đo:** 50 học sinh (WebSocket thật), 3 buổi liên tiếp × 6 câu × 5 giây/câu, tự chuyển câu, mọi học sinh trả lời mỗi câu, server và 50 client chạy trong một tiến trình, `--expose-gc`.

| Chỉ số | Kết quả |
| --- | --- |
| Đáp án được ghi | 900/900 (3 buổi × 300) |
| ACK nhận được | 900; p50 94 ms, p95 186 ms, tối đa 186 ms |
| Lỗi hoặc đáp án bị từ chối | 0 |
| Bộ nhớ (RSS) | 126 MB khi bắt đầu → 232 → 233 → 233 MB sau 3 buổi |
| Thời gian | khoảng 49 s mỗi buổi |

Kết luận: không thấy rò rỉ trong 3 buổi; bộ nhớ phẳng từ buổi thứ nhất. Đây **chưa phải** thử 30 phút liên tục và chưa có phần cứng/mạng thật.

**Các kịch bản đã chạy riêng (xem `BAO_CAO_BUG_VA_CACH_SUA_2026-10-13.md` mục 2):** khởi động lại server giữa buổi, bấm nhanh, đồng hồ lệch +90 s, tải lại trang.

## 3. Các bug đã sửa trong lượt này
BUG-002, 007, 008, 009, 012 và các mục văn bản T-010…T-014, T-017, T-019. Chi tiết trạng thái nằm trong hai báo cáo QA.

## 4. Việc vẫn cần bạn
- Đọc kiểm 20–30 lời giải trên **đề thật**; gửi lại lỗi để tinh chỉnh prompt.
- Thử ESP32 phần cứng, Tailscale Funnel, điện thoại học sinh, chạy 30 phút.
- Quyết định BUG-004 (đổi ngôn ngữ tải lại trang) và BUG-005 (số ít/số nhiều EN) có làm tiếp không.
