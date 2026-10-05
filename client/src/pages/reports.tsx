import { useState } from "react";
import { api, fmt, stateLabel, type Data } from "../api";
import { Empty, Head, Status, useApp, useResource } from "../components";
import { ResultsGrid, ResultsSummary } from "./results-grid";
import { ScoreStats } from "./score-stats";
import { StudyPlan } from "./study-plan";
function ResultImporter() {
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
      <h2>Tạo báo cáo từ kết quả đã có</h2>
      <p>
        Nhập file đáp án để tạo báo cáo hoàn tất mà không cần bắt đầu buổi kiểm
        tra trực tiếp. Dùng một dòng ANSWER_KEY và mỗi học sinh một dòng STUDENT;
        tải mẫu theo bộ đề đã chọn.
      </p>
      <div className="form-grid">
        <label className="field">
          Bộ đề (thứ tự câu phải khớp Q1…Qn)
          <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">Chọn bộ đề…</option>
            {banks.data?.map((bank: Data) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} · {bank.question_count} câu
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Tên báo cáo
          <input
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            maxLength={150}
            placeholder="Ví dụ: Kiểm tra cuối chương"
          />
        </label>
        <label className="field">
          Ngưỡng đạt / 10
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
      <fieldset className="choice-field">
        <legend>Danh sách học sinh</legend>
        <label>
          <input
            type="radio"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />{" "}
          Ghép vào lớp có sẵn theo mã học sinh
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />{" "}
          Tạo lớp/nhóm mới từ danh sách trong file
        </label>
      </fieldset>
      {mode === "existing" ? (
        <label className="field">
          Lớp
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
          Tên lớp/nhóm mới
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            maxLength={150}
            placeholder="Ví dụ: Nhóm ôn tập tháng 9"
          />
        </label>
      )}
      <div className="actions result-template-links">
        <a href={`/api/templates/results.xlsx?count=${selectedBank?.question_count || 3}`}>
          Tải mẫu Excel
        </a>
        <a href={`/api/templates/results.csv?count=${selectedBank?.question_count || 3}`}>
          Tải mẫu CSV
        </a>
      </div>
      <label className="field">
        File kết quả (.xlsx hoặc .csv)
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setPreview(null);
          }}
        />
      </label>
      <button
        disabled={!file || busy}
        onClick={() => {
          setBusy(true);
          void run(inspectFile).finally(() => setBusy(false));
        }}
      >
        {busy ? "Đang đọc file…" : "Kiểm tra file"}
      </button>
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
        />
        <ResultImporter />
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
        <a className="button primary" href={`/api/sessions/${id}/export.xlsx`}>
          Xuất Excel ↓
        </a>
        <button onClick={() => window.print()}>In / Lưu PDF</button>
      </Head>
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
        <p className="warning">
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
      <ScoreStats d={d} />
      {d.session.state === "FINISHED" && d.N > 0 && <StudyPlan d={d} id={id} />}
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
      <section className="card">
        <h2>Cần giáo viên xem xét <span className="badge">{reviewItems.length}</span></h2>
        {reviewItems.length ? reviewItems.map(({ student: st, detail: a }: { student: Data; detail: Data }) => <button className="review-item" key={`${st.id}:${a.question_id}`} onClick={() => { setSelectedCell({ student: st.id, question: a.question_id }); document.getElementById("results-grid")?.scrollIntoView({ behavior: "smooth" }); }}>{st.full_name} · câu {a.order} bỏ trống · {a.incidents.length} sự kiện liên quan →</button>) : <p className="muted">Không có.</p>}
      </section>
    </div>
  );
}
