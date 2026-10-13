import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

type HttpError = {
  code?: string;
  status?: number;
  type?: string;
  message?: string;
  details?: unknown;
};

export function httpErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  const e = error as HttpError;
  const validation = error instanceof ZodError;
  const constraint =
    typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT");
  const status = validation ? 422 : constraint ? 409 : e.status || 500;
  const code =
    status === 413
      ? "UPLOAD_TOO_LARGE"
      : e.type === "entity.parse.failed"
        ? "INVALID_JSON"
        : validation
          ? "INVALID_PAYLOAD"
          : constraint
            ? "CONFLICT"
            : e.code || "INTERNAL_ERROR";
  if (status >= 500)
    console.error(
      JSON.stringify({ requestId: res.getHeader("X-Request-Id"), code }),
    );
  if (status === 429) res.setHeader("Retry-After", "60");
  res.status(status).json({
    code,
    message:
      status === 413
        ? "Dữ liệu tải lên vượt dung lượng cho phép"
        : e.type === "entity.parse.failed"
          ? "Nội dung JSON không hợp lệ"
          : e.code === "AI_NOT_CONFIGURED"
            ? e.message
            : typeof e.code === "string" &&
                (e.code.startsWith("GEMINI_") ||
                  e.code.startsWith("OPENROUTER_"))
              ? e.message
              : validation
                ? "Dữ liệu chưa hợp lệ"
                : constraint
                  ? "Dữ liệu trùng hoặc đang được sử dụng"
                  : status >= 500
                    ? "Không thể hoàn tất thao tác; thử lại với mã tra cứu"
                    : e.message,
    fieldErrors: validation ? error.issues : e.details,
    requestId: res.getHeader("X-Request-Id"),
  });
}
