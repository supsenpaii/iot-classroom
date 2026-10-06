import { useRef, useState } from "react";
import { api, fmt, stateLabel, type Data } from "../api";
import { DeleteSessionButton, Empty, Head, Icon, Status, useApp, useResource } from "../components";
import { ResultsGrid, ResultsSummary } from "./results-grid";
import { ScoreStats } from "./score-stats";
import { StudyPlan } from "./study-plan";
function ResultImporter() {
  const fileInput = useRef<HTMLInputElement>(null);
  const classes = useResource<Data[]>("/classes"),
    banks = useResource<Data[]>("/question-banks"),
    { run } = useApp(),
    [mode, setMode] = useState<"existing" | "new">("existing"),
    [classId, setClassId] = useState(""),
    [className, setClassName] = useState(""),
    [bankId, setBankId] = useState(""),
    [reportName, setReportName] = useState(""),
    [passMark, setPassMark] = useState(5),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<Data | null>(null),
    [busy, setBusy] = useState(false);
  const selectedBank = banks.data?.find((bank) => bank.id === bankId);
  async function inspectFile() {
    if (!file) throw Error("Chọn file kết quả trước.");
    const result = await api<Data>("/imports/results/preview", "POST", file);
    setPreview(result);
  }
  async function createReport() {
    if (!preview || preview.errors.length)
      throw Error("Sửa lỗi file trước khi tạo báo cáo.");
    if (!bankId || !selectedBank)
      throw Error("Chọn bộ đề trước khi tạo báo cáo.");
    if (mode === "existing" && !classId)
      throw Error("Chọn lớp trước khi tạo báo cáo.");
    if (mode === "new" && !className.trim())
      throw Error("Nhập tên lớp/nhóm từ file.");
    setBusy(true);
    try {
      await run(async () => {
        const result = await api<{ id: string }>("/imports/results/commit", "POST", {
          name: reportName,
          bank_id: bankId,
          pass_mark: passMark,
          answer_key: preview.answerKey,
          students: preview.students,
          class:
            mode === "existing"
              ? { mode, class_id: classId }
              : { mode, name: className },
        });
        window.location.href = `/reports/${result.id}`;
      }, "Đã tạo báo cáo từ kết quả đã có.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card result-import">
      <header className="import-card-head">
        <h2>Tạo báo cáo từ kết quả đã có</h2>
        <p>Chọn bộ đề, danh sách học sinh và tải file kết quả để bắt đầu.</p>
      </header>
      <section className="import-section" aria-labelledby="import-info-title">
      <h3 id="import-info-title">1. Thông tin báo cáo</h3>
      <div className="import-fields">
        <label className="field">
          <span>Bộ đề</span>
          <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">Chọn bộ đề…</option>
            {banks.data?.map((bank: Data) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} · {bank.question_count} câu
              </option>
            ))}
          </select>
          <small>Thứ tự câu trong file phải khớp Q1…Qn của bộ đề.</small>
        </label>
        <label className="field">
          <span>Tên báo cáo</span>
          <input
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            maxLength={150}
            placeholder="Ví dụ: Kiểm tra cuối chương"
          />
        </label>
        <label className="field import-pass-mark">
          <span>Ngưỡng đạt /10</span>
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={passMark}
            onChange={(e) => setPassMark(Number(e.target.value))}
          />
        </label>
      </div>
      </section>
      <section className="import-section" aria-labelledby="import-students-title">
      <h3 id="import-students-title">2. Danh sách học sinh</h3>
      <div className="import-options" role="group" aria-labelledby="import-students-title">
        <label className={`import-option ${mode === "existing" ? "is-selected" : ""}`}>
          <input
            type="radio"
            name="import-student-mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          <span><strong>Ghép vào lớp có sẵn</strong><small>Đối chiếu theo mã học sinh</small></span>
        </label>
        <label className={`import-option ${mode === "new" ? "is-selected" : ""}`}>
          <input
            type="radio"
            name="import-student-mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          <span><strong>Tạo lớp/nhóm mới từ file</strong><small>Dùng danh sách học sinh trong file</small></span>
        </label>
      </div>
      {mode === "existing" ? (
        <label className="field">
          <span>Lớp</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Chọn lớp…</option>
            {classes.data?.map((cls: Data) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span>Tên lớp/nhóm mới</span>
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            maxLength={150}
            placeholder="Ví dụ: Nhóm ôn tập tháng 9"
          />
        </label>
      )}
      </section>
      <section className="import-section" aria-labelledby="import-file-title">
      <div className="import-section-head">
      <h3 id="import-file-title">3. File kết quả</h3>
      <div className="result-template-links">
        <a href={`/api/templates/results.xlsx?count=${selectedBank?.question_count || 3}`}>
          <span aria-hidden="true">↓</span> Tải mẫu Excel
        </a>
        <a href={`/api/templates/results.csv?count=${selectedBank?.question_count || 3}`}>
          <span aria-hidden="true">↓</span> Tải mẫu CSV
        </a>
      </div>
      </div>
      <label className="import-upload">
        <span className="import-upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </svg>
        </span>
        <strong>{file ? "Chọn file khác hoặc kéo thả để thay thế" : "Kéo thả file vào đây hoặc chọn file"}</strong>
        <span>Hỗ trợ .xlsx, .csv</span>
        <input
          ref={fileInput}
          aria-label="File kết quả (.xlsx hoặc .csv)"
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setPreview(null);
          }}
        />
      </label>
      {file && (
        <div className="import-selected-file" role="status">
          <span aria-hidden="true"><Icon name="file" /></span>
          <div><strong>{file.name}</strong><small>{file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(1)} MB`}</small></div>
          <button type="button" aria-label={`Xóa file ${file.name}`} onClick={() => {
            setFile(null);
            setPreview(null);
            if (fileInput.current) fileInput.current.value = "";
          }}>Xóa file</button>
        </div>
      )}
      <details className="import-file-help">
        <summary>Hướng dẫn điền file mẫu</summary>
        <p>Dùng một dòng <code>ANSWER_KEY</code> cho đáp án đúng và mỗi học sinh một dòng <code>STUDENT</code>. Tải mẫu theo bộ đề đã chọn; giữ đúng thứ tự câu hỏi.</p>
      </details>
      </section>
      <div className="import-footer">
      <button
        type="button"
        className="primary"
        disabled={!file || busy}
        onClick={() => {
          setBusy(true);
          void run(inspectFile).finally(() => setBusy(false));
        }}
      >
        {busy ? "Đang đọc file…" : "Kiểm tra file"}
      </button>
      </div>
      {preview && (
        <div className="result-preview">
          {preview.errors.length ? (
            <div className="alert">
              <strong>File có {preview.errors.length} lỗi:</strong>
              <ul>
                {preview.errors.slice(0, 20).map((error: Data, index: number) => (
                  <li key={index}>
                    Dòng {error.row} · {error.column}: {error.message}
                  </li>
                ))}
              </ul>
              {preview.errors.length > 20 && <p>Chỉ hiển thị 20 lỗi đầu.</p>}
            </div>
          ) : (
            <>
              <p>
                Đã đọc {preview.questionCount} câu và {preview.students.length} học
                sinh. Đáp án đúng: {preview.answerKey.join(" · ")}.
              </p>
              <p>
                Khi ghép lớp có sẵn, học sinh không có trong file sẽ được đánh dấu
                vắng trong báo cáo; mã trong file phải tồn tại ở lớp đó.
              </p>
              <button
                className="primary"
                disabled={busy || !reportName.trim() || !bankId}
                onClick={() => void createReport()}
              >
                {busy ? "Đang tạo báo cáo…" : "Tạo báo cáo từ file"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
export function ImportReportPage() {
  return (
    <div className="report-import-page">
      <Head
        eyebrow="BÁO CÁO"
        title="Nhập kết quả"
        description="Tạo báo cáo từ file Excel hoặc CSV đã có."
      >
        <a className="button" href="/reports">← Về danh sách báo cáo</a>
      </Head>
      <ResultImporter />
    </div>
  );
}
function ReportExportMenu({ id }: { id: string }) {
  return (
    <details className="report-export">
      <summary>Xuất báo cáo <span aria-hidden="true">⌄</span></summary>
      <div className="report-export-options">
        <a href={`/api/sessions/${id}/export.xlsx`}>Xuất Excel</a>
        <button type="button" onClick={() => window.print()}>In / Lưu PDF</button>
      </div>
    </details>
  );
}
function ReportSectionNav({ study }: { study: boolean }) {
  return (
    <nav className="report-section-nav" aria-label="Các phần của báo cáo">
      <a href="#report-overview">Tổng quan</a>
      <a href="#report-results">Kết quả</a>
      <a href="#report-statistics">Thống kê</a>
      <a href="#report-questions">Phân tích câu hỏi</a>
      <a href="#report-actions">{study ? "Ôn tập" : "Hành động tiếp theo"}</a>
    </nav>
  );
}
export function Reports({ id }: { id?: string }) {
  const r = useResource<Data>(id ? `/sessions/${id}/report` : "/sessions"),
    { run } = useApp(),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [selectedCell, setSelectedCell] = useState<{ student: string; question: string } | null>(null);
  if (!r.data) return <Status loading error={r.error} />;
  const d = r.data;
  if (!id)
    return (
      <>
        <Head
          eyebrow="BÁO CÁO"
          title="Hiểu lớp học qua từng câu trả lời."
          description="Xem kết quả, tìm câu cần ôn lại và xuất bảng điểm."
        >
          <a className="button primary" href="/reports/import">
            Nhập kết quả
          </a>
        </Head>
        <section className="card">
          <label className="field">
            Tìm buổi kiểm tra
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên buổi hoặc lớp"
            />
          </label>
          {(d as unknown as Data[])
            .filter((s) =>
              (s.name + s.class_name)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((s) => (
              <a className="list-item" key={s.id} href={`/reports/${s.id}`}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.class_name} ·{" "}
                    {new Date(s.created_at).toLocaleDateString("vi-VN")}
                  </small>
                </div>
                <span className="badge">{stateLabel[s.state]}</span>
                <span>→</span>
              </a>
            ))}
          {!d.length && (
            <Empty>
              Chưa có báo cáo. Kết quả sẽ xuất hiện sau khi tạo buổi kiểm tra.
            </Empty>
          )}
        </section>
      </>
    );
  const student = d.students.find((s: Data) => s.id === selected),
    reviewItems = d.students.flatMap((st: Data) => st.absent ? [] : st.details
      .filter((a: Data) => a.status === "CLOSED" && !a.voided && !a.choice && a.incidents.length)
      .map((a: Data) => ({ student: st, detail: a })));
  return (
    <div className="report-page">
      <Head
        eyebrow="BÁO CÁO BUỔI KIỂM TRA"
        title={d.session.name}
        description={`${d.session.class_name} · ${stateLabel[d.session.state]} · ${d.N}/${d.session.config.count} câu đã đóng hợp lệ${d.session.early_finish ? " · Kết thúc sớm" : ""}`}
      >
        <ReportExportMenu id={id} />
        <DeleteSessionButton id={id!} name={d.session.name} state={d.session.state} />
      </Head>
      <ReportSectionNav study={d.session.state === "FINISHED" && d.N > 0} />
      <section className="report-group report-overview" id="report-overview" aria-labelledby="report-overview-heading">
      <h2 className="report-group-heading" id="report-overview-heading">Tổng quan</h2>
      {!["FINISHED", "CANCELLED"].includes(d.session.state) && (
        <p className="warning">
          Buổi chưa kết thúc. Đây là thống kê tạm thời của các câu đã đóng.{" "}
          <a href={`/sessions/${id}`}>Về phòng kiểm tra →</a>
        </p>
      )}
      {d.session.state === "CANCELLED" && (
        <p className="alert">Buổi đã hủy — không có điểm chính thức.</p>
      )}
      {d.session.source === "IMPORT" && (
        <p className="report-info">
          Báo cáo được tạo từ file kết quả có sẵn; thời gian trả lời và nhật ký
          trực tiếp không có trong dữ liệu nhập.
        </p>
      )}
      {!d.N && (
        <p className="warning">
          Chưa có điểm: không có câu đã đóng hợp lệ để tính điểm.
        </p>
      )}
      <ResultsSummary d={d} />
      </section>
      <section className="report-group" id="report-results" aria-labelledby="report-results-heading">
      <h2 className="report-group-heading" id="report-results-heading">Kết quả học sinh</h2>
      <ResultsGrid
        d={d}
        reportId={id}
        reload={r.reload}
        selectedCell={selectedCell}
        setSelectedCell={setSelectedCell}
        onStudent={(studentId) => {
          setSelected(studentId);
          setTimeout(() => document.querySelector(".student-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
        }}
      />
      {student && (
        <section className="card student-detail">
          <div className="row spread">
            <h2>Chi tiết: {student.full_name}</h2>
            <button onClick={() => setSelected("")}>Đóng chi tiết</button>
          </div>
          <p>
            Đúng: {fmt(student.correct_rate, "%")} · Phản hồi trung bình:{" "}
            {student.response_ms == null
              ? "—"
              : fmt(student.response_ms / 1000, " giây")}{" "}
            (có ảnh hưởng của độ trễ mạng)
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Câu</th>
                  <th>Lựa chọn</th>
                  <th>Đáp án đúng</th>
                  <th>Phản hồi</th>
                  <th>Tính điểm</th>
                </tr>
              </thead>
              <tbody>
                {student.details.map((a: Data) => (
                  <tr key={a.question_id}>
                    <td>{a.order}</td>
                    <td>{a.choice || "Bỏ trống"}</td>
                    <td>{a.correct_answer}</td>
                    <td>
                      {a.response_ms == null
                        ? "—"
                        : fmt(a.response_ms / 1000, "s")}
                    </td>
                    <td>{a.scored ? "Có" : "Không"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {d.leaderboard?.length > 0 && d.N > 0 && (
        <section className="card report-leaderboard">
          <h2>Bảng xếp hạng thi đua</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Hạng</th>
                  <th>Học sinh</th>
                  <th>Điểm thi đua</th>
                  <th>Câu đúng</th>
                  <th>Chuỗi đúng dài nhất</th>
                </tr>
              </thead>
              <tbody>
                {d.leaderboard.map((r: Data) => (
                  <tr key={r.student_id}>
                    <td><span className={`lb-rank${r.rank <= 3 ? ` top-${r.rank}` : ""}`}>{r.rank}</span></td>
                    <td>{r.full_name}<small>{r.student_code}</small></td>
                    <td><strong>{r.points.toLocaleString("vi-VN")}</strong></td>
                    <td>{r.correct}/{d.N}</td>
                    <td>{r.best_streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </section>
      <section className="report-group" aria-labelledby="report-analysis-heading">
        <h2 className="report-group-heading" id="report-analysis-heading">Phân tích</h2>
        <ScoreStats d={d} />
      </section>
      <section className="report-group" id="report-actions" aria-labelledby="report-actions-heading">
        <h2 className="report-group-heading" id="report-actions-heading">Hành động tiếp theo</h2>
        {d.session.state === "FINISHED" && d.N > 0 && <StudyPlan d={d} id={id} />}
      <section className={`card report-review${reviewItems.length ? "" : " is-empty"}`}>
        {reviewItems.length ? <>
          <h2>Cần giáo viên xem xét <span className="badge">{reviewItems.length}</span></h2>
          {reviewItems.map(({ student: st, detail: a }: { student: Data; detail: Data }) => <button className="review-item" key={`${st.id}:${a.question_id}`} onClick={() => { setSelectedCell({ student: st.id, question: a.question_id }); document.getElementById("results-grid")?.scrollIntoView({ behavior: "smooth" }); }}>{st.full_name} · câu {a.order} bỏ trống · {a.incidents.length} sự kiện liên quan →</button>)}
        </> : <p className="muted">Không có câu hỏi nào cần xem xét.</p>}
      </section>
      </section>
    </div>
  );
}
