import { useState } from "react";
import { fmt, type Data } from "../api";

// Score summary, distribution, grade bands and per-question analysis for one session.
const num = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v)
    ? "—"
    : v.toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Vietnamese grading bands on the /10 scale.
const BANDS = [
  { key: "gioi", label: "Giỏi", rule: "≥ 8", min: 8 },
  { key: "kha", label: "Khá", rule: "6,5 – 8", min: 6.5 },
  { key: "tb", label: "Trung bình", rule: "5 – 6,5", min: 5 },
  { key: "yeu", label: "Yếu", rule: "3,5 – 5", min: 3.5 },
  { key: "kem", label: "Kém", rule: "< 3,5", min: -Infinity },
];
const bandOf = (score: number) => BANDS.find((b) => score >= b.min)!;
const difficulty = (p: number) => (p >= 0.7 ? ["Dễ", "easy"] : p >= 0.3 ? ["Vừa", "medium"] : ["Khó", "hard"]);
const discrimination = (d: number) =>
  d >= 0.3
    ? ["Phân loại tốt", "good"]
    : d >= 0.2
      ? ["Tạm được", "warn"]
      : d >= 0
        ? ["Chưa phân loại", "bad"]
        : ["Nghi sai đáp án", "bad"];

export function ScoreStats({ d }: { d: Data }) {
  const [hoverBin, setHoverBin] = useState<number | null>(null),
    [itemSort, setItemSort] = useState("order");
  const passMark: number = d.session.config.pass_mark;
  const scored = d.students.filter((s: Data) => s.score != null);
  const scores = scored.map((s: Data) => s.score as number).sort((a: number, b: number) => a - b);
  if (!scores.length)
    return (
      <section className="card score-stats">
        <h2>Thống kê điểm</h2>
        <p className="muted">Chưa có điểm.</p>
      </section>
    );
  const m = mean(scores)!,
    passed = scores.filter((s: number) => s >= passMark).length;
  const freq = new Map<number, number>();
  scores.forEach((s: number) => freq.set(s, (freq.get(s) ?? 0) + 1));
  const topFreq = Math.max(...freq.values()),
    modes = [...freq.entries()].filter(([, n]) => n === topFreq && n > 1).map(([v]) => v);
  // Classical test theory on the scored questions: p (difficulty), D (upper vs lower 27%), KR-20 reliability.
  const items = d.questions.filter((q: Data) => q.status === "CLOSED" && !q.voided);
  const takers = d.students.filter((s: Data) => !s.absent && s.score != null);
  const ranked = [...takers].sort((a: Data, b: Data) => b.C - a.C);
  const groupSize = Math.max(1, Math.round(ranked.length * 0.27));
  const upper = ranked.slice(0, groupSize),
    lower = ranked.slice(-groupSize);
  const correctOn = (st: Data, q: Data) => {
    const a = st.details.find((x: Data) => x.question_id === q.id);
    return !!a?.choice && a.choice === a.correct_answer;
  };
  const analysis = items.map((q: Data) => {
    const p = takers.length ? takers.filter((st: Data) => correctOn(st, q)).length / takers.length : 0;
    const D =
      upper.filter((st: Data) => correctOn(st, q)).length / groupSize -
      lower.filter((st: Data) => correctOn(st, q)).length / groupSize;
    const flags: { tone: string; text: string }[] = [];
    if (D < 0) {
      const tally = new Map<string, number>();
      upper.forEach((st: Data) => {
        const c = st.details.find((x: Data) => x.question_id === q.id)?.choice;
        if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      });
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      flags.push({
        tone: "bad",
        text: top && top !== q.data.correct_answer
          ? `Nhóm điểm cao chủ yếu chọn ${top}, kiểm tra lại đáp án ${q.data.correct_answer}`
          : "Nhóm điểm thấp làm đúng nhiều hơn nhóm điểm cao, kiểm tra lại đề",
      });
    } else if (D < 0.2) flags.push({ tone: "warn", text: "Câu chưa phân loại được học sinh giỏi và yếu" });
    if (p < 0.4 && D >= 0) flags.push({ tone: "warn", text: "Hơn một nửa lớp làm sai, nên giảng lại" });
    const severity = flags.some((f) => f.tone === "bad") ? 3 : flags.length ? 2 : 0;
    return { q, p, D, flags, severity };
  });
  const sortedItems = [...analysis].sort((a, b) =>
    itemSort === "review"
      ? b.severity - a.severity || a.D - b.D
      : itemSort === "hard"
        ? a.p - b.p
        : a.q.question_order - b.q.question_order,
  );
  // Histogram: ten one-point bins, the last one closed at 10.
  const bins = Array.from({ length: 10 }, (_, i) => ({
    from: i,
    to: i + 1,
    students: scored.filter((s: Data) => Math.min(9, Math.floor(s.score)) === i),
  }));
  const maxCount = Math.max(...bins.map((b) => b.students.length), 1);
  const W = 640,
    H = 250,
    L = 14,
    R = 14,
    T = 40,
    B = 30,
    x = (v: number) => L + (v / 10) * (W - L - R),
    y = (n: number) => T + 22 + (1 - n / maxCount) * (H - T - 22 - B),
    slot = (W - L - R) / 10,
    barW = slot * 0.62;
  const bandCounts = BANDS.map((b) => ({ ...b, n: scores.filter((s: number) => bandOf(s).key === b.key).length }));
  const topics = new Map<string, number[]>();
  analysis.forEach(({ q, p }: { q: Data; p: number }) => {
    const t = (q.data.topic || "").trim();
    if (t) topics.set(t, [...(topics.get(t) ?? []), p]);
  });
  const topicRows = [...topics.entries()]
    .map(([topic, ps]) => ({ topic, pct: (mean(ps) ?? 0) * 100, n: ps.length }))
    .sort((a, b) => a.pct - b.pct);
  const hovered = hoverBin == null ? null : bins[hoverBin];
  const barPath = (bx: number, by: number, w: number, h: number) => {
    const r = Math.min(4, h, w / 2);
    return `M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + w - r}Q${bx + w},${by} ${bx + w},${by + r}V${by + h}Z`;
  };
  return (
    <section className="card score-stats" aria-label="Thống kê điểm">
      <div className="ss-head">
        <h2>Thống kê điểm</h2>
        <span className="ss-sub">{scores.length} học sinh · đạt từ {num(passMark)}</span>
      </div>
      <div className="ss-strip">
        <div><span>Điểm trung bình</span><strong>{num(m)}</strong></div>
        <div><span>Cao nhất</span><strong>{num(scores.at(-1))}</strong></div>
        <div><span>Thấp nhất</span><strong>{num(scores[0])}</strong></div>
        <div><span>Đạt</span><strong>{passed}<small> / {scores.length}</small></strong></div>
        <div><span>Chưa đạt</span><strong>{scores.length - passed}</strong></div>
      </div>
      <div className="ss-grid">
        <figure className="ss-figure">
          <figcaption>
            <strong>Phổ điểm</strong>
            <span className="ss-key"><i className="pass" />Đạt</span>
            <span className="ss-key"><i className="fail" />Chưa đạt</span>
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} className="ss-hist" role="img" aria-label={`Phổ điểm: ${bins.map((b) => `${b.from}–${b.to}: ${b.students.length}`).join(", ")}`}>
            {bins.map((b, i) => {
              const n = b.students.length,
                bx = L + i * slot + (slot - barW) / 2,
                by = y(n),
                h = y(0) - by;
              return (
                <g
                  key={i}
                  className={`ss-bin${hoverBin === i ? " is-hover" : ""}`}
                  tabIndex={n ? 0 : -1}
                  onMouseEnter={() => setHoverBin(i)}
                  onMouseLeave={() => setHoverBin(null)}
                  onFocus={() => setHoverBin(i)}
                  onBlur={() => setHoverBin(null)}
                  aria-label={`${b.from} đến ${b.to} điểm: ${n} học sinh`}
                >
                  <rect x={L + i * slot} y={T} width={slot} height={y(0) - T} fill="transparent" />
                  {n > 0 && <path d={barPath(bx, by, barW, h)} className={b.from + 0.5 >= passMark ? "bar-pass" : "bar-fail"} />}
                  {n > 0 && (
                    <text x={bx + barW / 2} y={by - 8} textAnchor="middle" className="ss-count">{n}</text>
                  )}
                </g>
              );
            })}
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="ss-baseline" />
            {Array.from({ length: 11 }, (_, i) => i).map((t) => (
              <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="ss-axis">{t}</text>
            ))}
            <line x1={x(m)} x2={x(m)} y1={T - 4} y2={y(0)} className="ss-mean-line" />
            <g transform={`translate(${Math.min(W - R - 34, Math.max(L + 34, x(m)))}, ${T - 16})`}>
              <rect x={-34} y={-12} width={68} height={24} rx={12} className="ss-mean-pill" />
              <text x={0} y={4} textAnchor="middle" className="ss-mean-text">TB {num(m)}</text>
            </g>
          </svg>
          <p className="ss-caption" aria-live="polite">
            {hovered
              ? `${hovered.from}–${hovered.to === 10 ? "10" : `dưới ${hovered.to}`} điểm · ${hovered.students.length} học sinh${hovered.students.length ? `: ${hovered.students.map((s: Data) => s.full_name.split(" ").at(-1)).join(", ")}` : ""}`
              : " "}
          </p>
        </figure>
          <figure className="ss-figure">
            <figcaption><strong>Xếp loại học lực</strong></figcaption>
            <ul className="ss-band-rows">
              {bandCounts.map((b) => (
                <li key={b.key}>
                  <span className="ss-band-name"><i className={`band-${b.key}`} />{b.label}<small>{b.rule}</small></span>
                  <div className="ss-band-track"><i className={`band-${b.key}`} style={{ width: `${(b.n / scores.length) * 100}%` }} /></div>
                  <strong>{b.n}</strong>
                  <em>{Math.round((b.n / scores.length) * 100)}%</em>
                </li>
              ))}
            </ul>
          </figure>
      </div>
          {topicRows.length >= 2 && (
            <figure className="ss-figure ss-topics-fig">
              <figcaption><strong>Tỷ lệ đúng theo chủ đề</strong></figcaption>
              <ul className="ss-topics">
                {topicRows.map((t) => (
                  <li key={t.topic}>
                    <span>{t.topic}<small>{t.n} câu</small></span>
                    <div className="ss-topic-track"><i style={{ width: `${t.pct}%` }} /></div>
                    <strong>{Math.round(t.pct)}%</strong>
                  </li>
                ))}
              </ul>
            </figure>
          )}
      {analysis.length > 0 && (
        <div className="ss-items">
          <div className="ss-items-head">
            <h3>Phân tích câu hỏi</h3>
            <label className="results-select">
              Sắp xếp
              <select value={itemSort} onChange={(e) => setItemSort(e.target.value)}>
                <option value="order">Theo thứ tự câu</option>
                <option value="review">Câu cần xem lại trước</option>
                <option value="hard">Câu khó nhất trước</option>
              </select>
            </label>
          </div>
          <div className="ia-list" role="table" aria-label="Phân tích từng câu hỏi">
            <div className="ia-row ia-header" role="row">
              <span role="columnheader">Câu</span>
              <span role="columnheader">Nội dung và nhận xét</span>
              <span role="columnheader">Lựa chọn của lớp</span>
              <span role="columnheader">Làm đúng</span>
              <span role="columnheader">Phân loại HS</span>
              <span role="columnheader">TG trả lời</span>
            </div>
            {sortedItems.map(({ q, p, D, flags, severity }) => {
              const [dLabel, dTone] = difficulty(p),
                [qLabel, qTone] = discrimination(D),
                counts = ["A", "B", "C", "D"].map((c) => ({ c, n: q.counts[c] || 0, correct: c === q.data.correct_answer })),
                blank = Math.max(0, q.blank || 0),
                total = counts.reduce((sum, x) => sum + x.n, 0) + blank;
              return (
                <div className={`ia-row sev-${severity}`} role="row" key={q.id}>
                  <span className="ia-no" role="cell">{q.question_order}</span>
                  <div className="ia-text" role="cell">
                    <p title={q.data.question}>{q.data.question}</p>
                    {flags.map((f: { tone: string; text: string }) => (
                      <span key={f.text} className={`ia-flag ${f.tone}`}>{f.text}</span>
                    ))}
                  </div>
                  <div className="ia-dist" role="cell">
                    <div className="ia-bar" aria-label={counts.map((x) => `${x.c}: ${x.n}`).join(", ") + `, bỏ trống: ${blank}`}>
                      {counts.filter((x) => x.n > 0).map((x) => (
                        <span key={x.c} className={x.correct ? "seg-correct" : "seg-wrong"} style={{ width: `${(x.n / Math.max(1, total)) * 100}%` }} />
                      ))}
                      {blank > 0 && <span className="seg-blank" style={{ width: `${(blank / total) * 100}%` }} />}
                    </div>
                    <div className="ia-counts">
                      {counts.map((x) => (
                        <span key={x.c} className={x.correct ? "is-correct" : x.n === 0 ? "is-zero" : ""}>
                          <b>{x.c}</b>
                          {x.n}
                        </span>
                      ))}
                      {blank > 0 && <span className="is-zero"><b>–</b>{blank}</span>}
                    </div>
                  </div>
                  <div className="ia-metric" role="cell">
                    <strong>{Math.round(p * 100)}%</strong>
                    <span className={`level ${dTone}`}>{dLabel}</span>
                  </div>
                  <div className="ia-metric" role="cell">
                    <span className={`quality ${qTone}`}>
                      <b aria-hidden="true">{qTone === "good" ? "✓" : qTone === "warn" ? "!" : "✕"}</b>
                      {qLabel}
                    </span>
                  </div>
                  <span className="ia-time" role="cell">{q.response_ms == null ? "—" : `${num(q.response_ms / 1000)} giây`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <details className="ss-table">
        <summary>Xem bảng số liệu phổ điểm</summary>
        <table>
          <thead><tr><th>Khoảng điểm</th><th>Số học sinh</th><th>Tỷ lệ</th></tr></thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.from}>
                <td>{b.from} – {b.to === 10 ? "10" : `dưới ${b.to}`}</td>
                <td>{b.students.length}</td>
                <td>{Math.round((b.students.length / scores.length) * 100)}%</td>
              </tr>
            ))}
            <tr><td><b>Trung bình</b></td><td colSpan={2}>{fmt(m)}</td></tr>
          </tbody>
        </table>
      </details>
    </section>
  );
}
