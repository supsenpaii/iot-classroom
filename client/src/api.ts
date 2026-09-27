export type Data = Record<string, any>; // JSON API documents; inputs are validated by shared Zod schemas on the server.
let csrf = "";
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
    throw new Error("Mất kết nối máy chủ. Kiểm tra mạng rồi thử lại.");
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("Không đọc được phản hồi máy chủ. Thử lại sau.");
  if (!res.ok) {
    const error = new Error(
      (data.message || "Không kết nối được máy chủ") +
        (res.status >= 500 && data.requestId
          ? ` · Mã tra cứu: ${data.requestId}`
          : ""),
    ) as Error & { code: string; details: unknown };
    error.code = data.code;
    error.details = data.fieldErrors;
    throw error;
  }
  return data;
}
export const fields = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form));
export const fmt = (value: number | null | undefined, suffix = "") =>
  value == null
    ? "Chưa có điểm"
    : `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}${suffix}`;
export const stateLabel: Record<string, string> = {
  LOBBY: "Phòng chờ",
  RUNNING: "Đang diễn ra",
  PAUSED: "Tạm dừng",
  FINISHED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
  OPEN: "Đang nhận đáp án",
  CLOSED: "Đã đóng",
  PENDING: "Chưa mở",
  WAITING: "Chờ ghép thiết bị",
};

export const eventLabel: Record<string, string> = {
  start: "Bắt đầu kiểm tra",
  pause: "Tạm dừng",
  resume: "Tiếp tục",
  finish: "Kết thúc bài",
  cancel: "Hủy buổi",
  next: "Chuyển câu",
  "close-question": "Giáo viên đóng câu",
  "question.closed": "Câu đã đóng",
  "question.voided": "Loại câu khỏi tính điểm",
  "device.test": "Bấm thử thiết bị",
  "device.connected": "Thiết bị kết nối",
  "device.disconnected": "Thiết bị mất kết nối",
  "server.recovered": "Khôi phục máy chủ",
  "binding.changed": "Thay đổi ghép thiết bị",
};
export const errorLabel: Record<string, string> = {
  QUESTION_CLOSED: "Câu đã đóng hoặc hết giờ",
  SESSION_PAUSED: "Buổi đang tạm dừng",
  STALE_SEQUENCE: "Gói cũ, đã có lựa chọn mới hơn",
  DEVICE_NOT_ASSIGNED: "Thiết bị chưa ghép hoặc đã hết quyền",
  ANSWER_LOCKED: "Đã khóa lựa chọn đầu tiên",
  REQUEST_REUSED: "Mã gửi lại không khớp nội dung",
  INVALID_PAYLOAD: "Nội dung gửi không hợp lệ",
  STORAGE_ERROR: "Chưa lưu được đáp án; sẽ thử lại",
};
