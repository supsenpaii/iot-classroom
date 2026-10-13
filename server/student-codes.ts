import { studentCodeSchema, STUDENT_CODE_ERROR } from "../shared/student-code.js";
import { AppError, type Row } from "./db.js";

// Read old snapshots unchanged; reject legacy roster values before copying new ones.
export function assertValidStudentCodes(students: Row[]) {
  const invalid = students.filter((student) => {
    const parsed = studentCodeSchema.safeParse(student.student_code);
    return !parsed.success || parsed.data !== student.student_code;
  });
  if (invalid.length)
    throw new AppError(
      "INVALID_STUDENT_CODE",
      `Lớp còn MSSV không hợp lệ: ${invalid.map((student) => JSON.stringify(student.student_code)).join(", ")}. ${STUDENT_CODE_ERROR} Cần xác nhận sửa mã trước khi tạo phiên mới; dữ liệu cũ được giữ nguyên.`,
      422,
      invalid.map((student) => ({ student_id: student.id, student_code: student.student_code })),
    );
}
