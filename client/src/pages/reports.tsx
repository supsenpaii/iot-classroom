import { useState } from "react";
import { api, fmt, stateLabel, eventLabel, errorLabel, type Data } from "../api";
import { Empty, Head, Status, useApp, useResource } from "../components";
export function Reports({ id }: { id?: string }) {
  const r = useResource<Data>(id ? `/sessions/${id}/report` : "/sessions"),
    { run } = useApp(),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [matrixFilter, setMatrixFilter] = useState("all"),
    [eventStep, setEventStep] = useState(0),
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
    scoredStudents = d.students.filter((s: Data) => s.score != null),
    answeredQuestions = d.questions.filter((q: Data) => q.status !== "PENDING"),
    totals = d.students
      .filter((s: Data) => !s.absent)
      .reduce(
        (sum: { correct: number; wrong: number; blank: number }, s: Data) => ({
          correct: sum.correct + s.C,
          wrong: sum.wrong + s.W,
          blank: sum.blank + s.U,
        }),
        { correct: 0, wrong: 0, blank: 0 },
      ),
    attempts = totals.correct + totals.wrong + totals.blank,
    visibleQuestions = d.questions.filter((q: Data) => matrixFilter === "all" ||
      (matrixFilter === "voided" ? !!q.voided :
        matrixFilter === "early" ? q.status === "PENDING" :
        d.students.some((st: Data) => {
          const a = st.details.find((item: Data) => item.question_id === q.id);
          return matrixFilter === "blank" ? !st.absent && q.status === "CLOSED" && !q.voided && !a?.choice : !!a?.incidents?.length;
        }))),
    reviewItems = d.students.flatMap((st: Data) => st.absent ? [] : st.details
      .filter((a: Data) => a.status === "CLOSED" && !a.voided && !a.choice && a.incidents.length)
      .map((a: Data) => ({ student: st, detail: a }))),
    cellStudent = d.students.find((st: Data) => st.id === selectedCell?.student),
    cellDetail = cellStudent?.details.find((a: Data) => a.question_id === selectedCell?.question),
    activeEvent = d.events[Math.min(eventStep, d.events.length - 1)],
    activeEventDetail = activeEvent ? JSON.parse(activeEvent.detail) : null,
    activeEventStudent = d.students.find((st: Data) => st.id === (activeEventDetail?.student_id || activeEventDetail?.student)),
    replayEvents = d.events.slice(0, Math.min(eventStep, d.events.length - 1) + 1),
    replayOpened = [...replayEvents].reverse().find((e: Data) => e.type === "question.opened"),
    replayQuestion = d.questions.find((q: Data) => q.id === (replayOpened ? JSON.parse(replayOpened.detail).question_id : null)),
    replayClosed = replayOpened && replayEvents.some((e: Data) => e.id > replayOpened.id && e.type === "question.closed" && JSON.parse(e.detail).question_id === replayQuestion?.id),
    replayAnswers = replayQuestion ? new Set(replayEvents.filter((e: Data) => e.type === "answer.saved" && JSON.parse(e.detail).question_id === replayQuestion.id).map((e: Data) => JSON.parse(e.detail).student_id)).size : 0,
    replayState = [...replayEvents].reverse().find((e: Data) => ["start", "pause", "resume", "finish", "cancel"].includes(e.type));
  return (
    <>
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
      {!d.N && (
        <p className="warning">
          Chưa có điểm: không có câu đã đóng hợp lệ để tính điểm.
        </p>
      )}
      <div className="stat-grid">
        <div className="card stat">
          <span>Điểm trung bình</span>
          <strong>{fmt(d.stats.mean)}</strong>
          <small>Ngưỡng đạt: {d.session.config.pass_mark}/10</small>
        </div>
        <div className="card stat">
          <span>Tỷ lệ đạt</span>
          <strong>{fmt(d.stats.pass_rate, "%")}</strong>
          <small>{d.stats.participants} người dự thi</small>
        </div>
        <div className="card stat">
          <span>Trả lời đủ {d.N} câu</span>
          <strong>
            {d.stats.complete}/{d.stats.participants}
          </strong>
          <small>
            {d.students.length - d.stats.participants} học sinh vắng
          </small>
        </div>
      </div>
      <section className="card report-visuals">
        <h2>Biểu đồ tổng quan</h2>
        <div className="report-chart-grid">
          <div className="chart-panel">
            <h3>Phân bố điểm</h3>
            {scoredStudents.length ? (
              <div className="histogram" role="img" aria-label={`Phân bố điểm: ${d.stats.distribution.join(", ")} học sinh theo năm khoảng điểm từ 0 đến 10`}>
                {d.stats.distribution.map((count: number, i: number) => (
                  <div key={i}>
                    <span>{count}</span>
                    <div className="hist-bar" style={{ height: `${(count / Math.max(1, ...d.stats.distribution)) * 120}px` }} />
                    <small>{["0–2", "2–4", "4–6", "6–8", "8–10"][i]}</small>
                  </div>
                ))}
              </div>
            ) : <p className="muted">Chưa có điểm để vẽ biểu đồ.</p>}
            <p className="chart-caption">{scoredStudents.length} học sinh có điểm · Trung vị {fmt(d.stats.median)} · Cao nhất {fmt(d.stats.max)} · Thấp nhất {fmt(d.stats.min)}</p>
          </div>
          <div className="chart-panel">
            <h3>Đúng, sai và bỏ trống</h3>
            {attempts ? <>
              <div className="stacked-bar" role="img" aria-label={`${totals.correct} đúng, ${totals.wrong} sai, ${totals.blank} bỏ trống trong ${attempts} lượt của các câu đã đóng hợp lệ`}>
                <span className="correct" style={{ width: `${totals.correct / attempts * 100}%` }} />
                <span className="wrong" style={{ width: `${totals.wrong / attempts * 100}%` }} />
                <span className="blank" style={{ width: `${totals.blank / attempts * 100}%` }} />
              </div>
              <div className="chart-legend"><span><i className="correct" />{totals.correct} đúng</span><span><i className="wrong" />{totals.wrong} sai</span><span><i className="blank" />{totals.blank} bỏ trống</span></div>
            </> : <p className="muted">Chưa có câu tính điểm để tổng hợp lượt trả lời.</p>}
            <p className="chart-caption">{d.N} câu đã đóng hợp lệ · {d.stats.participants} học sinh dự thi</p>
          </div>
        </div>
      </section>
      <section className="card report-scores">
        <h2>Điểm theo học sinh</h2>
        {scoredStudents.length ? scoredStudents.map((s: Data) => (
          <div className="score-row" key={s.id}>
            <span>{s.full_name}<small>{s.student_code}</small></span>
            <div className="score-track" role="img" aria-label={`${s.full_name}: ${fmt(s.score)} trên 10 điểm`}><span style={{ width: `${Math.max(0, Math.min(100, s.score * 10))}%` }} /></div>
            <strong>{fmt(s.score)}/10</strong>
          </div>
        )) : <p className="muted">Chưa có điểm học sinh. Học sinh vắng và buổi đã hủy không có điểm chính thức.</p>}
        {d.students.length > scoredStudents.length && <p className="chart-caption">{d.students.length - scoredStudents.length} học sinh không có điểm; xem lý do ở bảng chi tiết bên dưới.</p>}
      </section>
      <section className="card report-questions-chart">
        <h2>Kết quả theo câu hỏi</h2>
        {answeredQuestions.length ? answeredQuestions.map((q: Data) => {
          const correct = q.counts[q.data.correct_answer] || 0,
            wrong = Object.values(q.counts).reduce((n: number, value) => n + Number(value), 0) - correct,
            blank = Math.max(0, q.blank || 0),
            total = correct + wrong + blank;
          return <div className="question-chart-row" key={q.id}>
            <div><strong>Câu {q.question_order}. {q.data.question}</strong>{!!q.voided && <span className="badge">Đã loại khỏi điểm</span>}</div>
            <div className="stacked-bar" role="img" aria-label={`Câu ${q.question_order}: ${correct} đúng, ${wrong} sai, ${blank} bỏ trống`}>
              <span className="correct" style={{ width: `${total ? correct / total * 100 : 0}%` }} />
              <span className="wrong" style={{ width: `${total ? wrong / total * 100 : 0}%` }} />
              <span className="blank" style={{ width: `${total ? blank / total * 100 : 0}%` }} />
            </div>
            <small>{correct} đúng · {wrong} sai · {blank} bỏ trống{q.voided ? " · Không tính điểm" : ""}</small>
          </div>;
        }) : <p className="muted">Chưa có câu đã mở để vẽ biểu đồ.</p>}
      </section>
      <section className="card result-matrix">
        <div className="row spread">
          <div><h2>Ma trận kết quả</h2><p className="muted">Chọn một ô để xem thời điểm lưu đáp án và sự cố liên quan.</p></div>
          <label>Lọc câu
            <select aria-label="Lọc ma trận kết quả" value={matrixFilter} onChange={(e) => setMatrixFilter(e.target.value)}>
              <option value="all">Tất cả</option><option value="blank">Có bỏ trống</option><option value="incident">Có sự cố</option><option value="early">Chưa mở do kết thúc sớm</option><option value="voided">Câu bị loại</option>
            </select>
          </label>
        </div>
        {visibleQuestions.length ? <div className="table-scroll">
          <table className="matrix-table">
            <thead><tr><th>Học sinh</th>{visibleQuestions.map((q: Data) => <th key={q.id}>Câu {q.question_order}</th>)}</tr></thead>
            <tbody>{d.students.map((st: Data) => <tr key={st.id}>
              <th scope="row">{st.full_name}<small>{st.student_code}</small></th>
              {visibleQuestions.map((q: Data) => {
                const a = st.details.find((item: Data) => item.question_id === q.id);
                const label = st.absent ? "Vắng" : q.status === "PENDING" ? "Chưa mở" : q.voided ? "Đã loại" : !a.choice ? "Bỏ trống" : a.choice === a.correct_answer ? "Đúng" : "Sai";
                return <td key={q.id}><button className={`matrix-cell ${label === "Đúng" ? "is-correct" : label === "Sai" ? "is-wrong" : label === "Bỏ trống" ? "is-blank" : ""}`} aria-label={`${st.full_name}, câu ${q.question_order}: ${label}${a.incidents.length ? ", có sự cố cần xem xét" : ""}`} onClick={() => setSelectedCell({ student: st.id, question: q.id })}>{label}{a.incidents.length > 0 && <span title="Có sự kiện cần xem xét"> · !</span>}</button></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div> : <p className="muted">Không có câu phù hợp bộ lọc.</p>}
        {cellStudent && cellDetail && <div className="matrix-detail" role="region" aria-label="Bằng chứng kết quả">
          <div className="row spread"><h3>{cellStudent.full_name} · câu {cellDetail.order}</h3><button onClick={() => setSelectedCell(null)}>Đóng</button></div>
          <p>Trạng thái: <b>{cellStudent.absent ? "Vắng" : cellDetail.status === "PENDING" ? "Chưa mở" : cellDetail.voided ? "Đã loại khỏi điểm" : !cellDetail.choice ? "Bỏ trống" : cellDetail.choice === cellDetail.correct_answer ? "Đúng" : "Sai"}</b> · Lựa chọn: {cellDetail.choice || "Không có đáp án lưu"} · Đáp án đúng: {cellDetail.correct_answer}</p>
          <p>Mở câu: {cellDetail.opened_at ? new Date(cellDetail.opened_at).toLocaleString("vi-VN") : "Chưa mở"} · Đóng câu: {cellDetail.closed_at ? new Date(cellDetail.closed_at).toLocaleString("vi-VN") : "Chưa đóng"} · Lưu đáp án: {cellDetail.received_at ? new Date(cellDetail.received_at).toLocaleString("vi-VN") : "Không có"}</p>
          <p>Thiết bị đã lưu: {cellDetail.device_label || "Không có"} · Sự kiện liên quan: {cellDetail.incidents.length || "Không có"}</p>
          {cellDetail.incidents.map((e: Data) => <p key={e.id} className="warning">{new Date(e.created_at).toLocaleString("vi-VN")} · {eventLabel[e.type] || e.type}{e.code ? ` · ${errorLabel[e.code] || e.code}` : ""}</p>)}
          {!!cellDetail.incidents.length && <small>Sự kiện trùng thời gian chỉ là dấu hiệu cần xem xét, không chứng minh học sinh đã bấm nút.</small>}
        </div>}
      </section>
      <section className="card">
        <h2>Cần giáo viên xem xét <span className="badge">{reviewItems.length}</span></h2>
        {reviewItems.length ? reviewItems.map(({ student: st, detail: a }: { student: Data; detail: Data }) => <button className="review-item" key={`${st.id}:${a.question_id}`} onClick={() => setSelectedCell({ student: st.id, question: a.question_id })}>{st.full_name} · câu {a.order} bỏ trống · {a.incidents.length} sự kiện liên quan →</button>) : <p className="muted">Không có câu bỏ trống trùng với sự kiện đã ghi nhận. Điều này không loại trừ sự cố chưa được thiết bị gửi tới máy chủ.</p>}
      </section>
      <section className="card report-students-table">
        <div className="row spread">
          <h2>Kết quả học sinh</h2>
          <input
            aria-label="Tìm học sinh báo cáo"
            placeholder="Tìm học sinh…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Học sinh</th>
                <th>Đúng</th>
                <th>Sai</th>
                <th>Bỏ trống</th>
                <th>Điểm</th>
                <th>Trả lời</th>
                <th>Kết quả</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {d.students
                .filter((s: Data) =>
                  (s.full_name + s.student_code)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((s: Data) => (
                  <tr key={s.id}>
                    <td>
                      {s.full_name}
                      <small>{s.student_code}</small>
                    </td>
                    <td>{s.absent ? "—" : s.C}</td>
                    <td>{s.absent ? "—" : s.W}</td>
                    <td>{s.absent ? "—" : s.U}</td>
                    <td>
                      <b>{fmt(s.score)}</b>
                    </td>
                    <td>{fmt(s.answer_rate, "%")}</td>
                    <td>
                      {s.absent
                        ? "Vắng"
                        : s.passed == null
                          ? "Chưa có điểm"
                          : s.passed
                            ? "Đạt"
                            : "Chưa đạt"}
                    </td>
                    <td>
                      <button onClick={() => setSelected(s.id)}>Xem</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {student && (
        <section className="card">
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
      <section className="card">
        <h2>Phân tích từng câu</h2>
        {d.questions.map((q: Data) => (
          <article className="report-question" key={q.id}>
            <div className="row spread">
              <h3>
                Câu {q.question_order}. {q.data.question}
              </h3>
              <span className="badge">
                {q.voided ? "Đã loại" : stateLabel[q.status]}
              </span>
            </div>
            <p>
              Đáp án đúng: <b>{q.data.correct_answer}</b> · Tỷ lệ đúng:{" "}
              {q.correct_rate == null ? "—" : fmt(q.correct_rate, "%")} · Bỏ
              trống: {q.blank ?? "—"}
            </p>
            <div className="choice-counts">
              {["A", "B", "C", "D"].map((c) => (
                <span key={c}>
                  {c}: <b>{q.counts[c]}</b>
                </span>
              ))}
            </div>
            {q.data.explanation && <p>Lời giải: {q.data.explanation}</p>}
            {q.voided ? (
              <p className="warning">Lý do loại: {q.void_reason}</p>
            ) : (
              q.status === "CLOSED" && (
                <form
                  className="row no-print"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const reason = String(
                      new FormData(e.currentTarget).get("reason"),
                    );
                    if (confirm("Loại câu này và tính lại điểm toàn lớp?"))
                      void run(async () => {
                        await api(
                          `/sessions/${id}/questions/${q.id}/void`,
                          "POST",
                          { reason },
                        );
                        r.reload();
                      }, "Đã loại câu và tính lại báo cáo.");
                  }}
                >
                  <input
                    name="reason"
                    aria-label={`Lý do loại câu ${q.question_order}`}
                    placeholder="Lý do loại câu"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                  <button className="danger">Loại câu khỏi tính điểm</button>
                </form>
              )
            )}
          </article>
        ))}
      </section>
      <details className="card">
        <summary>Nhật ký buổi và sự cố ({d.events.length})</summary>
        {!!d.events.length && <div className="event-replay">
          <label>Đọc theo dòng thời gian · sự kiện {Math.min(eventStep, d.events.length - 1) + 1}/{d.events.length}
            <input type="range" min="0" max={Math.max(0, d.events.length - 1)} value={Math.min(eventStep, d.events.length - 1)} onChange={(e) => setEventStep(Number(e.target.value))} />
          </label>
          <p>{new Date(activeEvent.created_at).toLocaleString("vi-VN")} · {eventLabel[activeEvent.type] || "Sự kiện buổi kiểm tra"}{activeEventStudent ? ` · ${activeEventStudent.full_name}` : ""}{activeEventDetail?.device_id ? ` · thiết bị …${activeEventDetail.device_id.slice(-6)}` : ""}{activeEventDetail?.code ? ` · ${errorLabel[activeEventDetail.code] || activeEventDetail.code}` : ""}</p>
          <p>{replayQuestion ? `Câu ${replayQuestion.question_order}: ${replayClosed ? "đã đóng" : "đang mở"} · ${replayAnswers}/${d.stats.participants} học sinh có đáp án lưu đến mốc này` : "Chưa có mốc mở câu để dựng trạng thái."} · {replayState?.type === "pause" ? "Tạm dừng" : replayState?.type === "finish" ? "Đã kết thúc" : replayState?.type === "cancel" ? "Đã hủy" : replayQuestion ? "Đang diễn ra" : "Phòng chờ"}</p>
          <small>Chỉ đọc sự kiện đã lưu; không chạy lại bài hoặc tính lại điểm. Buổi cũ thiếu mốc/sự kiện sẽ không có đầy đủ trạng thái phát lại.</small>
        </div>}
        {d.events.map((e: Data) => {
          const detail = JSON.parse(e.detail),
            who = d.students.find((st: Data) => st.id === (detail.student_id || detail.student));
          return <p key={e.id}>{new Date(e.created_at).toLocaleString("vi-VN")} · {eventLabel[e.type] || "Sự kiện buổi kiểm tra"}{who ? ` · ${who.full_name}` : ""}{detail.choice ? ` · ${detail.choice}` : ""}{detail.code ? ` · ${errorLabel[detail.code] || detail.code}` : ""}{detail.device_id ? ` · thiết bị …${detail.device_id.slice(-6)}` : ""}{detail.reason || detail.message ? ` · ${detail.reason || detail.message}` : ""}</p>;
        })}
      </details>
    </>
  );
}
