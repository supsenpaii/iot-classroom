# SmartClass

![ESP32-C3](https://img.shields.io/badge/ESP32--C3-RISC--V%20·%20Wi--Fi%20·%20BLE-E7352C?logo=espressif&logoColor=white)
![KiCad](https://img.shields.io/badge/KiCad-10-314CB0?logo=kicad&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-ACK-6E40C9)

Giáo viên chiếu câu hỏi, học sinh bấm đáp án trên thiết bị ESP32-C3. Đáp án đi qua Wi-Fi/WebSocket, được lưu vào SQLite rồi máy chủ mới trả ACK, nên kết quả hiện lên web ngay lập tức.

<table>
<tr>
<td width="38%" valign="top">

**Nội dung**

1. [Kiến trúc hệ thống](#1-kiến-trúc-hệ-thống)
2. [Phần cứng](#2-phần-cứng)
   - [Linh kiện](#21-linh-kiện)
   - [Sơ đồ nguyên lý](#22-sơ-đồ-nguyên-lý)
   - [Mạch in PCB](#23-mạch-in-pcb)
   - [Mô hình 3D](#24-mô-hình-3d)
   - [Gán chân](#25-gán-chân)
   - [File thiết kế](#26-file-thiết-kế)
3. [Firmware ESP32](#3-firmware-esp32)
4. [Phần mềm Web](#4-phần-mềm-web)
5. [Giao thức & độ tin cậy](#5-giao-thức--độ-tin-cậy)
6. [Cài đặt & chạy](#6-cài-đặt--chạy)

</td>
<td width="62%" valign="top">
<img src="docs/images/hardware/3d-iso.jpg" alt="Mạch thiết bị học sinh 3D">
<p align="center"><sub>Thiết bị học sinh: ESP32-C3, PCB 2 lớp 50 × 80 mm, 13 phím, OLED 0,91"</sub></p>
</td>
</tr>
</table>

---

## 1. Kiến trúc hệ thống

![Kiến trúc](docs/images/diagrams/architecture.png)

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Thiết bị học sinh | ESP32-C3-MINI-1-N4, bàn phím, OLED SSD1306 | Nhập ROOM ID + MSSV, gửi đáp án, hiện trạng thái |
| Backend | Node.js 24, Express 5, `ws` 8, SQLite (better-sqlite3) | Kiểm tra → lưu → ACK, máy trạng thái buổi thi |
| Frontend | React 19, Vite 8 | Bảng giáo viên, màn chiếu, báo cáo, `/student`, `/device` |
| AI ôn tập | Gemini (chính), OpenRouter (dự phòng) | Giải thích câu sai, sinh câu luyện thêm |

Học sinh không có thiết bị vẫn tham gia được bằng điện thoại qua `/student`, hoặc thiết bị ảo `/device`. Mọi nguồn đều dùng chung một đường WebSocket và một bộ luật chấm.

---

## 2. Phần cứng

PCB 2 lớp FR-4 1,6 mm, kích thước **50 × 80 mm**, 57 vị trí linh kiện, toàn bộ linh kiện ở mặt trên. ERC và DRC đều **0 lỗi**. Có 431 đoạn dây và 64 via. Dưới module ESP32 có 9 via tản nhiệt, cả hai mặt đổ đồng GND, chừa vùng cấm đồng dưới anten.

### 2.1 Linh kiện

| Khối | Linh kiện chính | Ghi chú |
|---|---|---|
| MCU | **ESP32-C3-MINI-1-N4** | RISC-V 160 MHz, Wi-Fi 2,4 GHz, BLE 5.0, flash 4 MB, anten PCB; USB Serial/JTAG có sẵn |
| Nguồn | 4 × AAA → **AMS1117-3.3** | Vin ≥ 4,3 V khi Wi-Fi phát (đỉnh ~350–400 mA) |
| Chọn nguồn / bảo vệ | **AO3401A** (P-MOS), **SS14**, **USBLC6-2SC6** | Chống ngược pin, tự ngắt pin khi cắm USB, chống ESD cho D+/D− |
| Giao tiếp | 13 phím 6×6 (0–9, OK, DEL, MODE), RESET/BOOT, SW1 MSS-22D18G2 | OLED 0,91" I²C qua header J3 |
| Báo hiệu | 3 LED 0805: nguồn / trạng thái / USB | Thụ động 0805 cho dễ hàn tay |

BOM đầy đủ: [`hardware/fabrication/IOT_BOM_V2.csv`](hardware/fabrication/IOT_BOM_V2.csv) (57 vị trí, cần mua 51 linh kiện).

### 2.2 Sơ đồ nguyên lý

![Sơ đồ nguyên lý toàn mạch](docs/images/hardware/schematic-full.png)

<table>
<tr>
<td width="50%"><img src="docs/images/hardware/sch-1-power.png" alt="Khối nguồn"><br><b>① Nguồn vào & bảo vệ.</b> Pin → SW1 → Q1 → VSYS. Cực G của Q1 nối VBUS: cắm USB thì Q1 ngắt, nguồn đi qua D1.</td>
<td width="50%"><img src="docs/images/hardware/sch-2-ldo.png" alt="Khối LDO"><br><b>② Ổn áp 3,3 V.</b> AMS1117-3.3. Ngõ ra dùng tụ tantalum 22 µF (cần ESR đủ lớn để LDO ổn định). LED D2 báo nguồn.</td>
</tr>
<tr>
<td><img src="docs/images/hardware/sch-3-usbc.png" alt="Khối USB-C"><br><b>③ USB-C.</b> CC1/CC2 qua 5,1 kΩ; D+/D− qua 22 Ω và USBLC6 tới IO19/IO18 để nạp firmware và xem log.</td>
<td><img src="docs/images/hardware/sch-4-mcu.png" alt="Khối MCU"><br><b>④ MCU.</b> EN có RC 10 kΩ / 1 µF + nút RESET; IO9 + nút BOOT. Chân strapping IO2, IO8 được kéo lên.</td>
</tr>
<tr>
<td><img src="docs/images/hardware/sch-5-keypad.png" alt="Khối bàn phím"><br><b>⑤ Bàn phím.</b> Ma trận 4 hàng × 3 cột cho 12 phím, MODE nối riêng → 13 phím chỉ tốn 8 GPIO.</td>
<td><img src="docs/images/hardware/sch-6-oled-led-bat.png" alt="Khối ngoại vi"><br><b>⑥ OLED / LED / đo pin.</b> I²C IO4/IO5 kéo lên 4,7 kΩ; LED trạng thái IO8; cầu chia 200k/100k đưa vào ADC IO3.</td>
</tr>
</table>

### 2.3 Mạch in PCB

<table>
<tr>
<td align="center" width="25%"><img src="docs/images/hardware/pcb-top.png" alt="Mặt trên"><br><sub>F.Cu + in lụa</sub></td>
<td align="center" width="25%"><img src="docs/images/hardware/pcb-bottom.png" alt="Mặt dưới"><br><sub>B.Cu (lật gương)</sub></td>
<td align="center" width="25%"><img src="docs/images/hardware/pcb-routing.png" alt="Đi dây 2 lớp"><br><sub>Đi dây 2 lớp</sub></td>
<td align="center" width="25%"><img src="docs/images/hardware/pcb-assembly.png" alt="Bản vẽ lắp ráp"><br><sub>Bản vẽ lắp ráp</sub></td>
</tr>
</table>

<p align="center"><img src="docs/images/diagrams/pcb-dimensions.png" width="420" alt="Kích thước PCB"><br><sub>Kích thước mạch (mm): bo góc R4, lỗ M3 cách mép 4 mm</sub></p>

Thông số đi dây: tín hiệu 0,25 mm, nguồn 0,4–0,5 mm, chân ESP32/USB 0,2 mm; khe hở tối thiểu 0,2 mm; via 0,6/0,3 mm. Thông số đặt xưởng: 2 lớp, đồng 1 oz, mạ **ENIG**, phủ xanh chữ trắng, kèm stencil.

### 2.4 Mô hình 3D

<table>
<tr>
<td align="center" width="50%"><img src="docs/images/hardware/3d-top.jpg" alt="3D mặt trên"><br><sub>Mặt trên</sub></td>
<td align="center" width="50%"><img src="docs/images/hardware/3d-bottom.jpg" alt="3D mặt dưới"><br><sub>Mặt dưới, có logo HCMUTE</sub></td>
</tr>
<tr>
<td align="center"><img src="docs/images/hardware/3d-zoom-mcu.jpg" alt="Cận cảnh MCU"><br><sub>ESP32-C3, AMS1117, header OLED</sub></td>
<td align="center"><img src="docs/images/hardware/3d-zoom-usb.jpg" alt="Cận cảnh USB"><br><sub>RESET/BOOT, công tắc SW1, USB-C</sub></td>
</tr>
</table>

### 2.5 Gán chân

Firmware hiện chạy trên **bản mẫu** (bo ESP32-C3 cắm USB + bàn phím 4×4 rời). Muốn dùng cho mạch PCB thì phải đổi bảng chân:

| Chức năng | Bản mẫu (firmware hiện tại) | Mạch PCB |
|---|---|---|
| Bàn phím | 4×4: hàng GPIO9, 10, 20, 21 · cột GPIO8, 7, 6, 5 | 4×3 + MODE: hàng IO0, IO1, IO2, IO10 · cột IO6, IO7, IO21 · MODE IO20 |
| Phím A–D | Phím riêng | MODE chuyển sang chế độ chữ |
| OLED I²C | SDA GPIO0, SCL GPIO1 | SDA IO4, SCL IO5 (kéo lên 4,7 kΩ) |
| LED / đo pin | — | LED IO8 · ADC IO3 |
| Nguồn | USB | 4×AAA hoặc USB-C |

### 2.6 File thiết kế

```
hardware/
├── kicad/                 # Project KiCad 10: mở IOT.kicad_pro
│   ├── IOT.kicad_sch / IOT.kicad_pcb / IOT.kicad_sym
│   ├── IOT.pretty/        # footprint riêng (ESP32-C3-MINI-1, MSS-22D18G2, nút 3×4)
│   └── 3dmodels/          # STEP (đường dẫn ${KIPRJMOD})
├── fabrication/           # Gerber .zip, BOM .csv/.xlsx, sơ đồ lắp ráp, bản in 1:1, hướng dẫn đặt mạch
└── Schematic_PCB.pdf      # Ảnh chi tiết sơ đồ, PCB, 3D (7 trang)
```

---

## 3. Firmware ESP32

`firmware/esp32-classroom/`: PlatformIO + Arduino, board `esp32-c3-devkitm-1`, USB CDC. Thư viện: ArduinoWebsockets, ArduinoJson 7, Adafruit SSD1306, Preferences (NVS).

```bash
cp firmware/esp32-classroom/include/device_config.example.h firmware/esp32-classroom/include/device_config.h
# điền Wi-Fi, DEVICE_ID/SECRET (lấy ở web: Thiết bị → Đăng ký), WS_HOST = IP máy chạy backend
pio run -d firmware/esp32-classroom -t upload
pio device monitor -d firmware/esp32-classroom
```

| Trạng thái OLED | Ý nghĩa |
|---|---|
| `ROOM ID + ENTER` → `STUDENT ID + ENTER` | Nhập mã phòng 8 số, rồi MSSV (1–10 số) |
| `READY / WAITING` | Đã ghép, chờ giáo viên bắt đầu |
| `QUIZ IN PROGRESS · Q 2/10 10s` | Đếm ngược theo giờ máy chủ |
| `SENDING: A` → `SAVED: A` | Chờ ACK → máy chủ đã lưu |
| `ATTENDANCE` / `QUICK POLL` / `FLASHCARD i/n` | Điểm danh (A), khảo sát (A–x), flashcard (A = nhớ, B = chưa nhớ) |

Các cơ chế chính:
- Chống dội phím 40 ms. Mỗi lần bấm chỉ tạo một sự kiện.
- Heartbeat 4 giây.
- Gói chưa nhận ACK được lưu NVS và gửi lại mỗi 1,2 giây, giữ nguyên `request_id`.
- OLED tự tắt khi rảnh (60/20/30 giây), nhưng luôn sáng trong lúc làm bài.

---

## 4. Phần mềm Web

<table>
<tr>
<td width="50%"><img src="docs/images/web/room-lobby.jpg" alt="Phòng chờ"><br><b>Phòng chờ.</b> ROOM ID 8 số, hiệu lực 5 phút. Thiết bị gửi MSSV để ghép đúng học sinh (10/10 đã kết nối).</td>
<td width="50%"><img src="docs/images/web/room-running.jpg" alt="Đang thi"><br><b>Điều khiển buổi thi.</b> Câu hiện tại, thời gian còn lại, số đáp án đã lưu, đóng câu / tạm dừng.</td>
</tr>
<tr>
<td><img src="docs/images/web/projector.jpg" alt="Màn chiếu"><br><b>Màn chiếu.</b> Câu hỏi và 4 lựa chọn theo màu/hình; công bố phân bố đáp án sau khi đóng câu.</td>
<td><img src="docs/images/web/virtual-device.png" alt="Thiết bị ảo"><br><b>Thiết bị ảo <code>/device</code>.</b> Mô phỏng OLED 128×32 + bàn phím, hành vi giống firmware (READY → SAVED).</td>
</tr>
<tr>
<td><img src="docs/images/web/report-overview.jpg" alt="Báo cáo"><br><b>Báo cáo.</b> Điểm trung bình, tỷ lệ đạt, ma trận học sinh × câu, xuất Excel/PDF.</td>
<td><img src="docs/images/web/report-statistics.jpg" alt="Thống kê"><br><b>Thống kê.</b> Phổ điểm, xếp loại, độ khó, độ phân biệt, thời gian trả lời từng câu.</td>
</tr>
<tr>
<td><img src="docs/images/web/devices.jpg" alt="Thiết bị"><br><b>Quản lý thiết bị.</b> Đăng ký, đổi tên, cấp lại secret, thu hồi.</td>
<td><img src="docs/images/web/device-rename.png" alt="Đổi tên thiết bị"><br><b>Đổi tên thiết bị.</b> Chỉ đổi nhãn quản lý; ID, secret, kết nối và báo cáo cũ giữ nguyên.</td>
</tr>
</table>

| Nhóm | Chức năng |
|---|---|
| Lớp & đề | Nhập học sinh/câu hỏi từ XLSX/CSV (xem trước, sửa lỗi), ngân hàng câu hỏi theo chủ đề |
| Buổi thi | 1–100 câu, 5–300 s/câu, trộn câu, tự chuyển, cho đổi đáp án, thi đua top 5; LOBBY → RUNNING ⇄ PAUSED → FINISHED |
| Báo cáo | Điểm = đúng ÷ câu tính điểm × 10; xếp loại; KR-20; loại câu và tính lại; nhập kết quả cũ |
| Hoạt động thêm | Flashcard (cả lớp + link tự học `/study/<mã>`), khảo sát nhanh ẩn danh, điểm danh 1 phím |
| AI | Giải chi tiết câu sai + câu luyện thêm; chỉ gửi nội dung đề, không gửi tên/MSSV |
| Khác | Giao diện VI/EN đổi tại chỗ, sáng/tối, dùng được trên điện thoại |

<p align="center"><img src="docs/images/diagrams/ai-flow.png" width="780" alt="Luồng AI"><br><sub>Luồng gợi ý ôn tập bằng AI</sub></p>

---

## 5. Giao thức & độ tin cậy

<p align="center"><img src="docs/images/diagrams/ack-flow.png" width="780" alt="ACK"></p>

```json
{ "v": 1, "type": "answer.submit", "request_id": "uuid-moi-lan-doi-dap-an",
  "session_id": "...", "question_instance_id": "...", "binding_id": "...", "seq": 1, "choice": "B" }
```

- `SAVED` chỉ hiện khi đã nhận `answer.ack`. Mất ACK thì gửi lại nguyên gói; máy chủ trả lại ACK cũ, không ghi trùng.
- Mỗi lần đổi đáp án thì tăng `seq`, nên gói cũ không thể đè lên lựa chọn mới. Hạn giờ do máy chủ quyết định.
- Lệnh của giáo viên kèm `command_id` + `expected_version` để chống bấm lặp (trả HTTP 409 nếu xung đột).
- Máy chủ khởi động lại thì buổi đang chạy chuyển sang `PAUSED`, đáp án đã ACK còn nguyên.
- Bảo mật: mật khẩu băm scrypt, cookie HttpOnly, CSRF, kiểm tra Origin, phiên học sinh tách riêng, giới hạn tốc độ đăng nhập/vào phòng.

<p align="center"><img src="docs/images/diagrams/integration-sequence.png" width="780" alt="Trình tự tích hợp"><br><sub>Trình tự một phiên: ghép phòng (HTTP) → WebSocket → thi → báo cáo</sub></p>

---

## 6. Cài đặt & chạy

Yêu cầu **Node 24.21+** (`nvm install && nvm use`).

```bash
npm ci
npm run build
cp .env.example .env          # điền SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run db:migrate
npm start                     # http://localhost:3000/register
```

**Demo không cần phần cứng.** Đặt `ENABLE_SIMULATOR=true`, chạy `npm run demo:create -- <email-giao-vien>` (lúc app đang dừng) để tạo lớp 10 học sinh, đề 10 câu và phòng chờ. Sau đó mở phòng → **Mở nhận thiết bị**, rồi vào phòng bằng `/simulator`, `/device` hoặc `/student`.

**ESP32 trong mạng LAN.** Đặt `HOST=0.0.0.0` và `PUBLIC_ORIGIN=http://<IP-LAN>:3000`. Trong `device_config.h` của firmware, đặt `WS_HOST=<IP-LAN>`. Không dùng `localhost` cho ESP32. ESP32-C3 chỉ hỗ trợ Wi-Fi **2,4 GHz**.

**Truy cập từ xa.** Dùng Tailscale Funnel hoặc `deploy/` (Docker + Caddy HTTPS/WSS). Khi chạy sau proxy, bắt buộc đặt `TRUST_PROXY=1`.

| Biến `.env` | Ý nghĩa |
|---|---|
| `SESSION_SECRET` | Bắt buộc, ≥ 32 ký tự ngẫu nhiên |
| `PUBLIC_ORIGIN` | Đúng địa chỉ trình duyệt mở, không có `/` ở cuối |
| `DATABASE_PATH` | File SQLite (mặc định `./data/app.sqlite`) |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEYS` | Bật tính năng AI ôn tập (chỉ lưu ở server) |

Vận hành: `npm run db:backup`, `npm run db:restore -- <file> --confirm-replace`, `npm run teacher:reset-password`.
