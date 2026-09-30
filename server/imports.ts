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
  if (kind === "results")
    return { ...parsed, warnings };
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
export async function previewResults(bytes: Buffer, name: string) {
  const parsed = await preview(bytes, name, "results"),
    errors = [...parsed.errors];
  const rows = parsed.rows as Row[],
    answerKeys = rows.filter((row) => row.row_type === "ANSWER_KEY"),
    studentRows = rows.filter((row) => row.row_type === "STUDENT"),
    invalidTypes = rows.filter(
      (row) => !["ANSWER_KEY", "STUDENT"].includes(String(row.row_type || "")),
    ),
    questionCount = rows.length
      ? Object.keys(rows[0]).filter((key) => /^Q\d+$/.test(key)).length
      : 0;
  invalidTypes.forEach((row) =>
    errors.push({
      row: rows.indexOf(row) + 2,
      column: "row_type",
      message: "row_type phải là ANSWER_KEY hoặc STUDENT",
    }),
  );
  if (!questionCount || questionCount > 100)
    errors.push({ row: 1, column: "", message: "File cần có từ Q1 đến tối đa Q100" });
  if (answerKeys.length !== 1)
    errors.push({ row: 2, column: "row_type", message: "Cần đúng một dòng ANSWER_KEY" });
  if (!studentRows.length)
    errors.push({ row: 3, column: "row_type", message: "Cần ít nhất một dòng STUDENT" });
  if (studentRows.length > 500)
    errors.push({ row: 1, column: "", message: "Tối đa 500 học sinh mỗi file" });
  const codes = new Set<string>(),
    answerKey = answerKeys[0]
      ? Array.from({ length: questionCount }, (_, i) =>
          String(answerKeys[0][`Q${i + 1}`] || "").trim().toUpperCase(),
        )
      : [];
  if (
    answerKey.some((choice) => !["A", "B", "C", "D"].includes(choice))
  )
    errors.push({ row: 2, column: "Q1…Qn", message: "Đáp án đúng phải là A, B, C hoặc D" });
  const students = studentRows.map((row, index) => {
    const student = studentSchema.safeParse(row);
    if (!student.success)
      for (const issue of student.error.issues)
        errors.push({
          row: index + 3,
          column: issue.path.join("."),
          message: issue.message,
        });
    const code = String(row.student_code || "").trim();
    if (code && codes.has(code.toLocaleLowerCase()))
      errors.push({ row: index + 3, column: "student_code", message: "Mã học sinh bị trùng trong file" });
    codes.add(code.toLocaleLowerCase());
    const answers = Array.from({ length: questionCount }, (_, i) => {
      const value = String(row[`Q${i + 1}`] || "").trim().toUpperCase();
      return value || null;
    });
    answers.forEach((choice, i) => {
      if (choice && !["A", "B", "C", "D"].includes(choice))
        errors.push({ row: index + 3, column: `Q${i + 1}`, message: "Lựa chọn phải là A, B, C, D hoặc để trống" });
    });
    return { student_code: code, full_name: String(row.full_name || "").trim(), answers };
  });
  return { answerKey, questionCount, students, errors };
}
export async function template(
  kind: string,
  format: string,
  questionCount = 3,
) {
  if (kind === "results") {
    const headers = [
        "row_type",
        "student_code",
        "full_name",
        ...Array.from({ length: questionCount }, (_, i) => `Q${i + 1}`),
      ],
      rows = [
        ["ANSWER_KEY", "", "", ...Array.from({ length: questionCount }, (_, i) => ["A", "B", "C", "D"][i % 4])],
        ["STUDENT", "HS001", "Nguyễn Minh Anh", ...Array.from({ length: questionCount }, (_, i) => ["A", "D", ""][i % 3])],
        ["STUDENT", "HS002", "Trần Minh Bình", ...Array.from({ length: questionCount }, (_, i) => ["C", "B", "C"][i % 3])],
      ];
    if (format === "csv")
      return Buffer.from(
        "\uFEFF" +
          [headers, ...rows]
            .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
            .join("\r\n") +
          "\r\n",
      );
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet("Results");
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    sheet.columns.forEach((c) => (c.width = 24));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
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
    ["Nguồn dữ liệu", report.session.source === "IMPORT" ? "Nhập kết quả có sẵn" : "Buổi kiểm tra trực tiếp"],
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
