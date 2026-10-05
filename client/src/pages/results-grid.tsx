import { useState } from "react";
import { api, fmt, eventLabel, errorLabel, type Data } from "../api";
import { ChoiceShape, useApp } from "../components";

// Mastery bands used everywhere on the results page: <60% red, 60–79% amber, >=80% green.
export const mastery = (pct: number | null | undefined) =>
  pct == null ? "none" : pct >= 80 ? "high" : pct >= 60 ? "mid" : "low";
const pctText = (pct: number | null | undefined) =>
  pct == null ? "—" : `${Math.round(pct)}%`;

function useStoredToggle(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved == null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* private mode: the toggle just is not remembered */
    }
  };
  return [value, set] as const;
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch${on ? " is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="switch-track" aria-hidden="true">
        <span />
      </span>
      {label}
    </button>
  );
}

// Ring gauge for one headline percentage; the arc carries the mastery colour, the text stays ink.
function Gauge({ pct }: { pct: number | null }) {
  const r = 52,
    c = 2 * Math.PI * r,
    filled = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg viewBox="0 0 128 128" className={`gauge mastery-${mastery(pct)}`} role="img" aria-label={`Điểm trung bình lớp ${pctText(pct)}`}>
      <circle cx="64" cy="64" r={r} className="gauge-track" />
      <circle
        cx="64"
        cy="64"
        r={r}
        className="gauge-arc"
        strokeDasharray={`${c * filled} ${c}`}
        transform="rotate(-90 64 64)"
      />
      <text x="64" y="64" textAnchor="middle" dominantBaseline="central" className="gauge-value">
        {pct == null ? "—" : Math.round(pct)}
        <tspan className="gauge-unit">{pct == null ? "" : "%"}</tspan>
      </text>
    </svg>
  );
}

export function ResultsSummary({ d }: { d: Data }) {
  const meanPct = d.stats.mean == null ? null : d.stats.mean * 10,
    completePct = d.stats.participants ? (d.stats.complete / d.stats.participants) * 100 : null,
    band = mastery(meanPct);
  return (
    <section className="results-hero" aria-label="Tóm tắt kết quả">
      <div className="results-hero-score">
        <Gauge pct={meanPct} />
        <div>
          <span className="eyebrow-label">Điểm trung bình lớp</span>
          <strong>{fmt(d.stats.mean)}<small>/10</small></strong>
          <span className={`pill mastery-${band}`}>
            {band === "high" ? "Lớp nắm bài tốt" : band === "mid" ? "Lớp nắm bài khá" : band === "low" ? "Cần ôn lại" : "Chưa có điểm"}
          </span>
        </div>
      </div>
      <dl className="results-hero-stats">
        <div>
          <dt>Học sinh tham gia</dt>
          <dd>{d.stats.participants}</dd>
          <small>{d.students.length - d.stats.participants} vắng</small>
        </div>
        <div>
          <dt>Hoàn thành đủ {d.N} câu</dt>
          <dd>{pctText(completePct)}</dd>
          <small>{d.stats.complete}/{d.stats.participants} học sinh</small>
        </div>
        <div>
          <dt>Tỷ lệ đạt (≥ {fmt(d.session.config.pass_mark)})</dt>
          <dd>{pctText(d.stats.pass_rate)}</dd>
          <small>cao nhất {fmt(d.stats.max)} · thấp nhất {fmt(d.stats.min)}</small>
        </div>
      </dl>
    </section>
  );
}

type Cell = { student: string; question: string } | null;
export function ResultsGrid({
  d,
  reportId,
  reload,
  selectedCell,
  setSelectedCell,
  onStudent,
}: {
  d: Data;
  reportId: string;
  reload: () => void;
  selectedCell: Cell;
  setSelectedCell: (cell: Cell) => void;
  onStudent: (id: string) => void;
}) {
  const { run } = useApp(),
    [showNames, setShowNames] = useStoredToggle("results:names", true),
    [showAnswers, setShowAnswers] = useStoredToggle("results:answers", true),
    [sort, setSort] = useState("name"),
    [filter, setFilter] = useState("all"),
    [questionId, setQuestionId] = useState<string | null>(null);
  const questions = d.questions.filter(
    (q: Data) =>
      filter === "all" ||
      (filter === "voided"
        ? !!q.voided
        : filter === "early"
          ? q.status === "PENDING"
          : d.students.some((st: Data) => {
              const a = st.details.find((item: Data) => item.question_id === q.id);
              return filter === "blank"
                ? !st.absent && q.status === "CLOSED" && !q.voided && !a?.choice
                : !!a?.incidents?.length;
            })),
  );
  const scorePct = (st: Data) => (st.score == null ? null : st.score * 10);
  const students = [...d.students].sort((a: Data, b: Data) =>
    sort === "name"
      ? a.full_name.split(" ").at(-1).localeCompare(b.full_name.split(" ").at(-1), "vi") ||
        a.full_name.localeCompare(b.full_name, "vi")
      : (sort === "high" ? -1 : 1) * ((scorePct(a) ?? -1) - (scorePct(b) ?? -1)),
  );
  const cellState = (st: Data, q: Data, a: Data | undefined) =>
    st.absent
      ? "absent"
      : q.status === "PENDING"
        ? "pending"
        : q.voided
          ? "voided"
          : !a?.choice
            ? "blank"
            : a.choice === a.correct_answer
              ? "correct"
              : "wrong";
  const stateText: Record<string, string> = {
    absent: "Vắng",
    pending: "Chưa mở",
    voided: "Đã loại",
    blank: "Bỏ trống",
    correct: "Đúng",
    wrong: "Sai",
  };
  const question = d.questions.find((q: Data) => q.id === questionId),
    qIndex = question ? d.questions.indexOf(question) : -1,
    cellStudent = d.students.find((st: Data) => st.id === selectedCell?.student),
    cellDetail = cellStudent?.details.find((a: Data) => a.question_id === selectedCell?.question);
  const openQuestion = (id: string) => {
    setQuestionId(id);
    setTimeout(() => document.querySelector(".question-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  };
  return (
    <section className="card results-grid-card" id="results-grid">
      <div className="results-toolbar">
        <div>
          <h2>Kết quả</h2>
        </div>
        <div className="results-controls">
          <Switch label="Hiện tên" on={showNames} onChange={setShowNames} />
          <Switch label="Hiện đáp án" on={showAnswers} onChange={setShowAnswers} />
          <label className="results-select">
            Sắp xếp
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Tên A–Z</option>
              <option value="high">Điểm cao → thấp</option>
              <option value="low">Điểm thấp → cao</option>
            </select>
          </label>
          <label className="results-select">
            Lọc câu
            <select aria-label="Lọc câu trong bảng kết quả" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Tất cả</option>
              <option value="blank">Có bỏ trống</option>
              <option value="incident">Có sự cố</option>
              <option value="early">Chưa mở do kết thúc sớm</option>
              <option value="voided">Câu bị loại</option>
            </select>
          </label>
        </div>
      </div>
      <div className="results-legend" aria-hidden="true">
        <span><i className="cell-correct" />Đúng</span>
        <span><i className="cell-wrong" />Sai</span>
        <span><i className="cell-blank" />Bỏ trống</span>
        <span><i className="pill mastery-high" />≥ 80%</span>
        <span><i className="pill mastery-mid" />60–79%</span>
        <span><i className="pill mastery-low" />&lt; 60%</span>
      </div>
      {questions.length ? (
        <div className="table-scroll results-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th scope="col" className="rt-name">Học sinh</th>
                <th scope="col" className="rt-score">Điểm</th>
                {questions.map((q: Data) => (
                  <th scope="col" key={q.id} className={q.id === questionId ? "is-active" : ""}>
                    <button
                      className="rt-q"
                      onClick={() => openQuestion(q.id)}
                      aria-label={`Xem chi tiết câu ${q.question_order}`}
                    >
                      {q.question_order}
                    </button>
                    {q.status === "CLOSED" && !q.voided && q.correct_rate != null && (
                      <span className="rt-qbar" aria-hidden="true">
                        <i className={`mastery-${mastery(q.correct_rate)}`} style={{ width: `${q.correct_rate}%` }} />
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((st: Data, row: number) => {
                const pct = scorePct(st);
                return (
                  <tr key={st.id}>
                    <th scope="row" className="rt-name">
                      {showNames ? (
                        <button className="rt-student" onClick={() => onStudent(st.id)}>
                          <span className="rt-avatar" aria-hidden="true">
                            {st.full_name.trim().split(/s+/).at(-1)?.charAt(0).toUpperCase()}
                          </span>
                          <span>
                            {st.full_name}
                            <small>{st.student_code}</small>
                          </span>
                        </button>
                      ) : (
                        <span className="rt-anon">Học sinh {String(row + 1).padStart(2, "0")}</span>
                      )}
                    </th>
                    <td className="rt-score">
                      <span className={`pill mastery-${st.absent ? "none" : mastery(pct)}`}>
                        {st.absent ? "Vắng" : pctText(pct)}
                      </span>
                    </td>
                    {questions.map((q: Data) => {
                      const a = st.details.find((item: Data) => item.question_id === q.id),
                        state = cellState(st, q, a),
                        active = selectedCell?.student === st.id && selectedCell?.question === q.id;
                      return (
                        <td key={q.id}>
                          <button
                            className={`rt-cell cell-${state}${active ? " is-active" : ""}`}
                            aria-label={`${showNames ? st.full_name : `Học sinh ${row + 1}`}, câu ${q.question_order}: ${stateText[state]}${a?.choice ? `, chọn ${a.choice}` : ""}${a?.incidents?.length ? ", có sự cố" : ""}`}
                            onClick={() => setSelectedCell(active ? null : { student: st.id, question: q.id })}
                          >
                            {state === "absent" || state === "pending" || state === "voided"
                              ? ""
                              : state === "blank"
                                ? "–"
                                : showAnswers
                                  ? a?.choice
                                  : state === "correct"
                                    ? "✓"
                                    : "✕"}
                            {a?.incidents?.length > 0 && <i className="rt-flag" title="Có sự kiện cần xem xét" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="rt-name">Cả lớp</th>
                <td className="rt-score">
                  <span className={`pill mastery-${mastery(d.stats.mean == null ? null : d.stats.mean * 10)}`}>
                    {pctText(d.stats.mean == null ? null : d.stats.mean * 10)}
                  </span>
                </td>
                {questions.map((q: Data) => (
                  <td key={q.id}>
                    <button
                      className={`rt-total mastery-${q.voided || q.status === "PENDING" ? "none" : mastery(q.correct_rate)}`}
                      onClick={() => openQuestion(q.id)}
                      aria-label={`Câu ${q.question_order}: ${pctText(q.correct_rate)} cả lớp đúng`}
                    >
                      {q.voided ? "Loại" : q.status === "PENDING" ? "—" : pctText(q.correct_rate)}
                    </button>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="muted">Không có câu phù hợp bộ lọc.</p>
      )}
      {cellStudent && cellDetail && (
        <div className="matrix-detail" role="region" aria-label="Bằng chứng kết quả">
          <div className="row spread">
            <h3>{cellStudent.full_name} · câu {cellDetail.order}</h3>
            <button onClick={() => setSelectedCell(null)}>Đóng</button>
          </div>
          <p>
            Trạng thái: <b>{cellStudent.absent ? "Vắng" : cellDetail.status === "PENDING" ? "Chưa mở" : cellDetail.voided ? "Đã loại khỏi điểm" : !cellDetail.choice ? "Bỏ trống" : cellDetail.choice === cellDetail.correct_answer ? "Đúng" : "Sai"}</b> · Lựa chọn: {cellDetail.choice || "Không có đáp án lưu"} · Đáp án đúng: {cellDetail.correct_answer}
            {cellDetail.response_ms != null && ` · Trả lời sau ${fmt(cellDetail.response_ms / 1000, " giây")}`}
          </p>
          <p>
            Mở câu: {cellDetail.opened_at ? new Date(cellDetail.opened_at).toLocaleString("vi-VN") : "Chưa mở"} · Đóng câu: {cellDetail.closed_at ? new Date(cellDetail.closed_at).toLocaleString("vi-VN") : "Chưa đóng"} · Lưu đáp án: {cellDetail.received_at ? new Date(cellDetail.received_at).toLocaleString("vi-VN") : "Không có"}
          </p>
          <p>Thiết bị đã lưu: {cellDetail.device_label || "Không có"} · Sự kiện liên quan: {cellDetail.incidents.length || "Không có"}</p>
          {cellDetail.incidents.map((e: Data) => (
            <p key={e.id} className="warning">
              {new Date(e.created_at).toLocaleString("vi-VN")} · {eventLabel[e.type] || e.type}
              {e.code ? ` · ${errorLabel[e.code] || e.code}` : ""}
            </p>
          ))}
        </div>
      )}
      {question && (
        <QuestionDrill
          q={question}
          d={d}
          showNames={showNames}
          index={qIndex}
          onNavigate={(step) => setQuestionId(d.questions[qIndex + step]?.id ?? questionId)}
          onClose={() => setQuestionId(null)}
          onVoid={(reason) =>
            void run(async () => {
              await api(`/sessions/${reportId}/questions/${question.id}/void`, "POST", { reason });
              reload();
            }, "Đã loại câu và tính lại báo cáo.")
          }
        />
      )}
    </section>
  );
}

function QuestionDrill({
  q,
  d,
  showNames,
  index,
  onNavigate,
  onClose,
  onVoid,
}: {
  q: Data;
  d: Data;
  showNames: boolean;
  index: number;
  onNavigate: (step: number) => void;
  onClose: () => void;
  onVoid: (reason: string) => void;
}) {
  const answered = ["A", "B", "C", "D"].reduce((n, c) => n + (q.counts[c] || 0), 0),
    total = answered + Math.max(0, q.blank || 0),
    pickers = (c: string) =>
      d.students
        .filter((st: Data) => st.details.find((a: Data) => a.question_id === q.id)?.choice === c)
        .map((st: Data) => st.full_name.split(" ").at(-1));
  return (
    <div className="question-drill" role="region" aria-label={`Chi tiết câu ${q.question_order}`}>
      <div className="row spread">
        <div className="qd-nav">
          <button disabled={index <= 0} onClick={() => onNavigate(-1)} aria-label="Câu trước">←</button>
          <span>Câu {q.question_order}/{d.questions.length}</span>
          <button disabled={index >= d.questions.length - 1} onClick={() => onNavigate(1)} aria-label="Câu sau">→</button>
        </div>
        <div className="actions">
          <span className={`pill mastery-${q.voided || q.status === "PENDING" ? "none" : mastery(q.correct_rate)}`}>
            {q.voided ? "Đã loại" : q.status === "PENDING" ? "Chưa mở" : `${pctText(q.correct_rate)} đúng`}
          </span>
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
      <h3>{q.data.question}</h3>
      <div className="qd-options">
        {["A", "B", "C", "D"].map((c) => {
          const n = q.counts[c] || 0,
            pct = total ? (n / total) * 100 : 0,
            correct = c === q.data.correct_answer,
            names = showNames ? pickers(c) : [];
          return (
            <div key={c} className={`qd-option choice-${c.toLowerCase()}${correct ? " is-correct" : ""}`}>
              <b>{c}</b>
              <div className="qd-body">
                <span className="qd-label">
                  {q.data[`option_${c.toLowerCase()}`]}
                  {correct && <em>Đáp án đúng</em>}
                </span>
                <div className="qd-track" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </div>
                {names.length > 0 && (
                  <small className="qd-names">
                    {names.slice(0, 12).join(", ")}
                    {names.length > 12 && ` và ${names.length - 12} bạn khác`}
                  </small>
                )}
              </div>
              <ChoiceShape choice={c} />
              <strong>
                {n}
                <small>{Math.round(pct)}%</small>
              </strong>
            </div>
          );
        })}
      </div>
      <p className="muted">
        {answered} trả lời · {Math.max(0, q.blank ?? 0)} bỏ trống
        {q.response_ms != null && ` · trả lời trung bình sau ${fmt(q.response_ms / 1000, " giây")}`}
      </p>
      {q.data.explanation && <p className="qd-explain">Lời giải: {q.data.explanation}</p>}
      {q.voided ? (
        <p className="warning">Lý do loại: {q.void_reason}</p>
      ) : (
        q.status === "CLOSED" && (
          <form
            className="row no-print"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason"));
              if (confirm("Loại câu này và tính lại điểm toàn lớp?")) onVoid(reason);
            }}
          >
            <input
              name="reason"
              aria-label={`Lý do loại câu ${q.question_order}`}
              placeholder="Lý do loại câu (vd: đề sai)"
              minLength={3}
              maxLength={500}
              required
            />
            <button className="danger">Loại câu khỏi tính điểm</button>
          </form>
        )
      )}
    </div>
  );
}
