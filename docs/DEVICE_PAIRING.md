# SmartClass: thiết bị dùng chung theo phiên

Phạm vi: phương án B đã được người dùng xác nhận, tiếp nối các refactor Giai đoạn 1. Không triển khai tối ưu chấm điểm, realtime, firmware, authentication hoặc dependency ngoài nhu cầu pairing.

## Quy tắc

- ID/secret xác thực thiết bị; label là tên quản lý. Thiết bị đã tồn tại không bị đổi label/credentials khi join MSSV mới. Không đổi hàng loạt label hoặc dữ liệu hiện có.
- Join có `student_code` tìm đúng MSSV trong snapshot phiên, giữ số 0 đầu, kiểm tra vắng/đã ghép. Join không có MSSV luôn chờ giáo viên ghép thủ công. `auto_assign` vẫn được chấp nhận/lưu trong API cũ nhưng không suy danh tính từ label hoặc thứ tự đến.
- Một binding active trên mỗi thiết bị và mỗi học sinh. Phòng chờ ở phiên khác cũng giữ thiết bị, kể cả chưa có binding; phải gỡ membership trước khi chuyển. Sau FINISHED/CANCELLED, join phiên mới dùng request ID mới và credentials cũ.
- Giáo viên bind/rebind trong LOBBY/PAUSED. Endpoint sửa ghép theo room-device giữ `expected_version`, transaction và rollback nếu học sinh/thiết bị không hợp lệ. Trong RUNNING không sửa ghép.
- Binding ID mới phân biệt lần sử dụng mới. Packet cũ không ghi cho học sinh mới. Phiên còn hoạt động từ chối answer dùng binding inactive; phiên đã kết thúc/hủy có thể trả receipt ACK cũ mà không ghi thêm. Retry join không undo quyết định rebind của giáo viên. Browser học sinh vẫn giữ scope binding riêng.
- Simulator vào bằng ROOM ID, chờ giáo viên chọn MSSV trong quản lý thiết bị rồi bấm thử. Dropdown không đòi label=MSSV; loại học sinh vắng/đã có thiết bị khác. Nút ghép theo thứ tự được thay bằng mở quản lý thủ công.

## Lịch sử và điểm danh

Binding mới lưu nhãn trong event `binding.changed` (`binding_id`, `device_label`). Báo cáo lấy snapshot nhãn, không lấy tên thiết bị đã đổi ở phiên sau. Handler `device.rename` legacy giữ packet/ACK và các guard cũ; trước khi rename, nó bổ sung `binding.label.snapshot` cho binding cũ chưa có nhãn trong cùng transaction. Điểm, đáp án, binding ID và event gốc không bị sửa; report có thêm audit events bảo tồn nhãn.

Không đổi schema hoặc chạy migration/backfill trên database thật. Binding cũ chưa có snapshot tiếp tục hiển thị label đang có; trước lần rename tiếp theo, label đó được bảo tồn. Không thể phục hồi label nguyên thủy nếu nó đã bị đổi trước bản cập nhật mà không có snapshot; không suy đoán hoặc sửa dữ liệu lịch sử đó.

Quiz không cập nhật mapping `student_devices`. Điểm danh vẫn snapshot mapping mặc định hiện có, độc lập với học sinh dùng thiết bị trong quiz. Trước khi dùng thiết bị cho học sinh khác để điểm danh, giáo viên cần kiểm tra mapping riêng; hệ thống không tự chuyển nó theo join/rebind.

## Compatibility

- Giữ route, method và cấu trúc packet API. Có thay đổi semantics: label không phải MSSV; manual binding không còn `STUDENT_CODE_MISMATCH`; client không gửi MSSV không tự ghép, kể cả gửi `auto_assign:true`. Nhãn join của thiết bị mới lấy `device_name`, không lấy `student_code`.
- WebSocket v1, answer/ACK/request_id/seq/deadline/receipt giữ nguyên. Thêm metadata/event nội bộ cho báo cáo, không thêm packet WebSocket mới.
- Schema SQLite, thuật toán tính điểm và ownership/credentials giữ nguyên. Không đụng database thật, `.env` hoặc secret.
- Firmware hiện gửi đủ MSSV/ID/secret, không cần thay packet hay nạp firmware chỉ để dùng backend này. Source/GPIO/OLED không sửa. NVS pending join và reboot recovery giữ nguyên giới hạn hiện có.

## Kiểm thử

Chỉ chạy SQLite `:memory:` hoặc database mới trong thư mục test tạm. Không chạy `demo:create`, `db:migrate` hoặc server production để kiểm tra.

```sh
npm run typecheck
npm run build
node scripts/test-room-pairing.mjs
node scripts/test-student-room-pairing.mjs
node scripts/test-device-reuse.mjs
node scripts/test-room-pairing-ui.mjs
node scripts/test-student-web.mjs
node scripts/test-device-rename.mjs
node scripts/test-device-results.mjs
node scripts/test-registration.mjs
node scripts/test-class-deletion.mjs
node scripts/test-session-deletion.mjs
node scripts/test-http-errors.mjs
git diff --check
```

`test-room-pairing`: giữ assertion manual bind/rebind thành công với label `ESP32`. Fixture 50 WebSocket gửi MSSV rõ ràng, giữ kiểm tra 50 assignment/ACK, restart/Excel, giới hạn phòng, revoke và rate limit.

`test-student-room-pairing`: MSSV chính xác, nhãn độc lập và không bị join đổi, duplicate/absent/unknown/occupied, rollback và legacy rename.

`test-device-reuse` (mới): ID/secret ổn định, label số không auto-assign, simulator manual flow, xung đột phiên/học sinh, rollback rebind, answer ACK/receipt cũ, reconnect, dùng lại ở phiên sau, điểm đúng sau kết thúc, báo cáo legacy giữ nhãn qua rename và mapping điểm danh không đổi.

`test-room-pairing-ui` (mới): render component TSX thực tế; simulator label bất kỳ có thể chọn MSSV hợp lệ, loại học sinh vắng/đã ghép, giữ lựa chọn binding hiện tại, chặn sửa khi RUNNING/thu hồi. Test đóng BroadcastChannel đã tạo; không gọi API/network/database. Đây không thay thế browser E2E.

Nếu sandbox báo `listen EPERM` hoặc build báo `EROFS`, chạy lại đúng lệnh với quyền phù hợp; không sửa code để tránh kiểm thử.

Kết quả ngày 2026-10-13: typecheck/build và cả 11 script trên PASS; `git diff --check` PASS. Baseline trước thay đổi pairing vẫn FAIL ở `test-room-pairing.mjs:107` (409 thay vì 200). Sau phương án B, assertion 200 ở dòng này được giữ và PASS; bài test chạy hết cả phần 50 WebSocket/restart/Excel. EPERM/EROFS của môi trường đã được xử lý bằng chạy lại với quyền phù hợp, không bypass test. Báo cáo `REFACTOR_PHASE_1.md` được giữ nguyên như ghi nhận của lượt refactor trước; kết quả pairing hiện tại nằm ở tài liệu này.

## Cần kiểm tra trên ESP32 thật

1. Cùng board/credentials join MSSV A ở phiên đầu và MSSV B ở phiên sau; kiểm tra nhãn quản lý giữ nguyên.
2. Giáo viên tạm dừng/rebind; snapshot đổi binding, pending answer cũ bị xóa, đáp án mới ghi đúng học sinh.
3. Mất phản hồi HTTP/ACK: retry đúng packet, không ghi trùng hoặc chuyển binding ngược lại.
4. Mất Wi-Fi/WebSocket, reconnect và reboot trong lúc join đang chờ hoặc sau join thành công. Reboot sau join thành công chưa được cải thiện ở lượt này.
5. OLED hiển thị đúng kết quả cá nhân, phím A/B/C/D và thời gian vẫn theo server. TLS/HTTPS và trải nghiệm trình duyệt đầy đủ chưa được kiểm chứng bằng test render.
