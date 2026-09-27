import { Worker } from "node:worker_threads";
import ExcelJS from "exceljs";
import { z } from "zod";
import { questionSchema } from "../shared/protocol.js";
import { AppError, type Row } from "./db.js";
export const studentSchema = z.object({
  student_code: z.string().trim().min(1).max(50),
  full_name: z.string().trim().min(1).max(150),
});
export async function preview(bytes: Buffer, name: string, kind = "questions") {
  const parsed = await new Promise<{ rows: Row[]; errors: Row[] }>(
    (resolve, reject) => {
      const worker = new Worker(
        new URL("./import-worker.mjs", import.meta.url),
        {
          workerData: { bytes, name, kind },
          resourceLimits: {
            maxOldGenerationSizeMb: 96,
            maxYoungGenerationSizeMb: 16,
          },
        },
      );
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(
          new AppError("PARSE_TIMEOUT", "File mất quá nhiều thời gian để đọc"),
        );
      }, 5000);
      worker.once("message", (r) => {
        clearTimeout(timer);
        void worker.terminate();
        if (r.error) reject(new AppError("INVALID_FILE", r.error));
        else resolve(r);
      });
      worker.once("error", () => {
        clearTimeout(timer);
        reject(
          new AppError(
            "INVALID_FILE",
            "Không thể đọc file trong giới hạn tài nguyên",
          ),
        );
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new AppError("INVALID_FILE", "Parser đã dừng"));
      });
    },
  );
  const warnings: Row[] = [];
  const seen = new Set<string>();
  parsed.rows.forEach((r, i) => {
    const result = (
      kind === "students" ? studentSchema : questionSchema
    ).safeParse(r);
    if (!result.success)
      for (const e of result.error.issues)
        parsed.errors.push({
          row: i + 2,
          column: e.path.join("."),
          message: e.message,
        });
    else parsed.rows[i] = result.data;
    const key = String(
      kind === "students" ? r.student_code : r.question,
    ).toLowerCase();
    if (seen.has(key))
      (kind === "students" ? parsed.errors : warnings).push({
        row: i + 2,
        column: kind === "students" ? "student_code" : "question",
        message: "Nội dung trùng với dòng trước",
      });
    seen.add(key);
  });
  if (!parsed.rows.length)
    parsed.errors.push({
      row: 2,
      column: "",
      message: "File không có dữ liệu",
    });
  return { ...parsed, warnings };
}
export async function template(kind: string, format: string) {
  const headers =
    kind === "students"
      ? ["student_code", "full_name"]
      : [
          "question",
          "option_a",
          "option_b",
          "option_c",
          "option_d",
          "correct_answer",
          "explanation",
          "topic",
          "difficulty",
        ];
  const sample =
    kind === "students"
      ? ["HS001", "Nguyễn Minh Anh"]
      : [
          "Giá trị của 3² + 4² là bao nhiêu?",
          "12",
          "25",
          "49",
          "7",
          "B",
          "9 + 16 = 25",
          "Lũy thừa",
          "easy",
        ];
  if (format === "csv")
    return Buffer.from(
      "\uFEFF" + headers.join(",") + "\r\n" + sample.join(",") + "\r\n",
    );
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet(kind === "students" ? "Students" : "Questions");
  sheet.addRow(headers);
  sheet.addRow(sample);
  sheet.columns.forEach((c) => (c.width = 25));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function reportExcel(report: Row) {
  const wb = new ExcelJS.Workbook();
  const summary = wb.addWorksheet("Tong_quan");
  summary.addRows([
    ["Buổi kiểm tra", report.session.name],
    ["Lớp", report.session.class_name],
    ["Trạng thái", report.session.state],
    ["Kết thúc sớm", report.session.early_finish ? "Có" : "Không"],
    ["Câu tính điểm", report.N],
    ["Dự kiến", report.session.config.count],
    ["Ngưỡng đạt", report.session.config.pass_mark],
    ...Object.entries(report.stats)
      .filter(([k]) => k !== "distribution")
      .map(([k, v]) => [k, v]),
    [
      "Phân bố [0,2),[2,4),[4,6),[6,8),[8,10]",
      report.stats.distribution.join(" / "),
    ],
  ]);
  const st = wb.addWorksheet("Hoc_sinh");
  st.addRow([
    "Mã",
    "Họ tên",
    "Vắng",
    "Đúng",
    "Sai",
    "Bỏ trống",
    "Điểm",
    "Tỷ lệ đúng",
    "Tỷ lệ trả lời",
    "Đạt",
    "Phản hồi (ms)",
    ...report.questions.map((q: Row) => `Câu ${q.question_order}`),
  ]);
  for (const s of report.students)
    st.addRow([
      s.student_code,
      s.full_name,
      s.absent ? "Có" : "Không",
      s.C,
      s.W,
      s.U,
      s.score == null ? null : Number(s.score.toFixed(1)),
      s.correct_rate,
      s.answer_rate,
      s.passed == null ? "Chưa có điểm" : s.passed ? "Đạt" : "Chưa đạt",
      s.response_ms,
      ...s.details.map((d: Row) => d.choice ?? "—"),
    ]);
  const qs = wb.addWorksheet("Tung_cau");
  qs.addRow([
    "Thứ tự",
    "Câu hỏi",
    "Trạng thái",
    "Đáp án",
    "A",
    "B",
    "C",
    "D",
    "Bỏ trống",
    "Tỷ lệ đúng",
    "Phản hồi (ms)",
    "Loại",
    "Lý do",
    "Lời giải",
  ]);
  for (const q of report.questions)
    qs.addRow([
      q.question_order,
      q.data.question,
      q.status,
      q.data.correct_answer,
      q.counts.A,
      q.counts.B,
      q.counts.C,
      q.counts.D,
      q.blank,
      q.correct_rate,
      q.response_ms,
      q.voided ? "Có" : "Không",
      q.void_reason,
      q.data.explanation,
    ]);
  // ExcelJS strings stay text, including values beginning with = + - @.
  for (const sheet of wb.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 24));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
