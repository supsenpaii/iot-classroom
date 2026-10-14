import { t, locale, translateServer, getLang } from "./i18n";
export type Data = Record<string, any>; // JSON API documents; inputs are validated by shared Zod schemas on the server.
export type ApiError = Error & { code: string | undefined; details: unknown };
type ApiErrorResponse = {
  code?: string;
  message?: string;
  requestId?: string;
  fieldErrors?: unknown;
};
let csrf = "";
const authChannel = new BroadcastChannel("classroom-auth");
authChannel.onmessage = (event) => {
  if (event.data === "signed-out" && !["/student", "/student/", "/device", "/device/"].includes(window.location.pathname)) window.location.replace("/login");
};
export function signedOut() {
  csrf = "";
  authChannel.postMessage("signed-out");
  window.location.replace("/login");
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      ...(body instanceof File
        ? {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(body.name),
          }
        : body
          ? { "Content-Type": "application/json" }
          : {}),
      "X-CSRF-Token": csrf,
    },
    body: body instanceof File ? body : body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new Error(t("Mất kết nối máy chủ. Kiểm tra mạng rồi thử lại."));
  });
  const data: unknown = await res.json().catch(() => null);
  if (!data) throw new Error(t("Chưa đọc được phản hồi từ máy chủ. Hãy thử lại sau ít phút."));
  if (!res.ok) {
    if (res.status === 401 && !["/auth/login", "/auth/me", "/presentation/exchange"].includes(path))
      signedOut();
    const failure = data as ApiErrorResponse;
    // Validation failures: say which field and why (server messages are Vietnamese).
    const first = Array.isArray(failure.fieldErrors) ? (failure.fieldErrors[0] as { path?: unknown[]; message?: string } | undefined) : undefined;
    const field = first?.path?.length ? fieldLabel(String(first.path[first.path.length - 1])) : "";
    const detail = res.status === 422 && field ? `: ${field}${getLang() === "vi" && first?.message ? ` — ${first.message}` : ""}` : "";
    const error = new Error(
      (failure.message ? translateServer(failure.message) : t("Không kết nối được máy chủ")) + detail +
        (res.status >= 500 && failure.requestId
          ? t(" · Mã tra cứu: {requestId}", { requestId: failure.requestId })
          : ""),
    ) as ApiError;
    error.code = failure.code;
    error.details = failure.fieldErrors;
    throw error;
  }
  return data as T;
}
// Labels for the fields that most often fail validation; unknown fields show their key.
const fieldLabel = (key: string) =>
  ({
    name: t("Tên"), email: "Email", password: t("Mật khẩu"), current: t("Mật khẩu hiện tại"),
    question: t("Câu hỏi"), option_a: t("Lựa chọn {c}", { c: "A" }), option_b: t("Lựa chọn {c}", { c: "B" }),
    option_c: t("Lựa chọn {c}", { c: "C" }), option_d: t("Lựa chọn {c}", { c: "D" }),
    correct_answer: t("Đáp án đúng"), explanation: t("Lời giải:"), topic: t("Chủ đề"),
    student_code: t("Mã học sinh"), full_name: t("Họ tên"), seconds: t("Thời gian"), count: t("Số câu"),
    subject: t("Môn học"), reason: t("Lý do"),
  }[key] ?? key);
export const fields = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form));
export const fmt = (value: number | null | undefined, suffix = "") =>
  value == null
    ? t("Chưa có điểm")
    : `${value.toLocaleString(locale(), { maximumFractionDigits: 1 })}${suffix}`;
export const stateLabel: Record<string, string> = {
  LOBBY: t("Phòng chờ"),
  RUNNING: t("Đang diễn ra"),
  PAUSED: t("Tạm dừng"),
  FINISHED: t("Đã kết thúc"),
  CANCELLED: t("Đã hủy"),
  OPEN: t("Đang nhận đáp án"),
  CLOSED: t("Đã đóng"),
  PENDING: t("Chưa mở"),
  WAITING: t("Chờ ghép thiết bị"),
};

export const eventLabel: Record<string, string> = {
  start: t("Bắt đầu kiểm tra"),
  pause: t("Tạm dừng"),
  resume: t("Tiếp tục"),
  finish: t("Kết thúc bài"),
  cancel: t("Hủy buổi"),
  next: t("Chuyển câu"),
  "close-question": t("Giáo viên đóng câu"),
  "question.closed": t("Câu đã đóng"),
  "question.opened": t("Mở câu hỏi"),
  "question.voided": t("Loại câu khỏi tính điểm"),
  "device.test": t("Bấm thử thiết bị"),
  "device.connected": t("Thiết bị kết nối"),
  "device.disconnected": t("Thiết bị mất kết nối"),
  "server.recovered": t("Khôi phục máy chủ"),
  "binding.changed": t("Thay đổi ghép thiết bị"),
  "binding.label.snapshot": t("Lưu nhãn thiết bị của phiên"),
  "answer.saved": t("Đã lưu đáp án"),
  "answer.rejected": t("Đáp án không hợp lệ"),
  "reveal-results": t("Công bố kết quả lên màn chiếu"),
  "results.imported": t("Nhập kết quả có sẵn"),
};
export const errorLabel: Record<string, string> = {
  QUESTION_CLOSED: t("Câu đã đóng hoặc hết giờ"),
  SESSION_PAUSED: t("Buổi đang tạm dừng"),
  STALE_SEQUENCE: t("Gói cũ, đã có lựa chọn mới hơn"),
  DEVICE_NOT_ASSIGNED: t("Thiết bị chưa ghép hoặc đã hết quyền"),
  ANSWER_LOCKED: t("Đã khóa lựa chọn đầu tiên"),
  REQUEST_REUSED: t("Mã gửi lại không khớp nội dung"),
  INVALID_PAYLOAD: t("Nội dung gửi không hợp lệ"),
  INVALID_STATE: t("Chỉ thử nút khi ở phòng chờ hoặc tạm dừng"),
  STORAGE_ERROR: t("Chưa lưu được đáp án; sẽ thử lại"),
  REVIEW_CLOSED: t("Buổi ôn tập đã kết thúc"),
  CARD_CHANGED: t("Giáo viên đã chuyển sang thẻ khác"),
  ROUND_CHANGED: t("Vòng ôn tập đã thay đổi; chờ trạng thái mới"),
  DISPLAY_CHANGED: t("Lượt hiển thị thẻ đã thay đổi; chờ trạng thái mới"),
  DEVICE_BUSY: t("Thiết bị đang dùng cho bài kiểm tra"),
  POLL_CLOSED: t("Khảo sát đã đóng"),
  INVALID_CHOICE: t("Lựa chọn không có trong khảo sát"),
  ATTENDANCE_CLOSED: t("Điểm danh đã đóng"),
};
