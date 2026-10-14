import { useEffect, useState } from "react";
import { fmt, type Data } from "../api";
import { t, locale } from "../i18n";

// Score summary, distribution, grade bands and per-question analysis for one session.
const num = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v)
    ? "—"
    : v.toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: digits });
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
// Vietnamese grading bands on the /10 scale.
const BANDS = [
  { key: "gioi", label: t("Giỏi"), rule: "≥ 8", min: 8 },
  { key: "kha", label: t("Khá"), rule: t("6,5 – 8"), min: 6.5 },
  { key: "tb", label: t("Trung bình"), rule: t("5 – 6,5"), min: 5 },
  { key: "yeu", label: t("Yếu"), rule: t("3,5 – 5"), min: 3.5 },
  { key: "kem", label: t("Kém"), rule: t("< 3,5"), min: -Infinity },
];
const bandOf = (score: number) => BANDS.find((b) => score >= b.min)!;
const difficulty = (p: number) => (p >= 0.7 ? [t("Dễ"), "easy"] : p >= 0.3 ? [t("Vừa"), "medium"] : [t("Khó"), "hard"]);
const discrimination = (d: number) =>
  d >= 0.3
    ? [t("Phân loại tốt"), "good"]
    : d >= 0.2
      ? [t("Tạm được"), "warn"]
      : d >= 0
        ? [t("Chưa phân loại"), "bad"]
        : [t("Nghi sai đáp án"), "bad"];

export function ScoreStats({ d }: { d: Data }) {
  const [hoverBin, setHoverBin] = useState<number | null>(null),
    [itemSort, setItemSort] = useState("order"),
    [itemFilter, setItemFilter] = useState("all"),
    [topicSort, setTopicSort] = useState("low"),
    [compactDistribution, setCompactDistribution] = useState(() =>
      typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
    );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setCompactDistribution(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const passMark: number = d.session.config.pass_mark;
  const scored = d.students.filter((s: Data) => s.score != null);
  const scores = scored.map((s: Data) => s.score as number).sort((a: number, b: number) => a - b);
  if (!scores.length)
    return (
      <section className="card score-stats" id="report-statistics">
        <h2>{t("Thống kê điểm")}</h2>
        <p className="muted">{t("Chưa có điểm.")}</p>
        <div id="report-questions"><h3>{t("Phân tích câu hỏi")}</h3><p className="muted">{t("Chưa có câu được chấm điểm để phân tích.")}</p></div>
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
          ? t("Nhóm điểm cao chủ yếu chọn {top}, kiểm tra lại đáp án {correct_answer}", { top, correct_answer: q.data.correct_answer })
          : t("Nhóm điểm thấp làm đúng nhiều hơn nhóm điểm cao, kiểm tra lại đề"),
      });
    } else if (D < 0.2) flags.push({ tone: "warn", text: t("Câu chưa phân loại được học sinh giỏi và yếu") });
    if (p < 0.4 && D >= 0) flags.push({ tone: "warn", text: t("Hơn một nửa lớp làm sai, nên giảng lại") });
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
  const visibleItems = sortedItems.filter(item =>
    itemFilter === "all" ||
    (itemFilter === "low" ? item.p < 0.6 :
      itemFilter === "unclassified" ? item.D >= 0 && item.D < 0.2 : item.flags.length > 0),
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
    .sort((a, b) => topicSort === "name" ? a.topic.localeCompare(b.topic, "vi") : a.pct - b.pct);
  const hovered = hoverBin == null ? null : bins[hoverBin];
  const barPath = (bx: number, by: number, w: number, h: number) => {
    const r = Math.min(4, h, w / 2);
    return `M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + w - r}Q${bx + w},${by} ${bx + w},${by + r}V${by + h}Z`;
  };
  return (
    <section className="card score-stats" id="report-statistics" aria-label={t("Thống kê điểm")}>
      <div className="ss-head">
        <h2>{t("Thống kê điểm")}</h2>
        <span className="ss-sub">{scores.length}  {t("học sinh · đạt từ")} {num(passMark)}</span>
      </div>
      <div className="ss-strip">
        <div><span>{t("Điểm trung bình")}</span><strong>{num(m)}</strong></div>
        <div><span>{t("Cao nhất")}</span><strong>{num(scores.at(-1))}</strong></div>
        <div><span>{t("Thấp nhất")}</span><strong>{num(scores[0])}</strong></div>
        <div><span>{t("Đạt")}</span><strong>{passed}<small> / {scores.length}</small></strong></div>
        <div><span>{t("Chưa đạt")}</span><strong>{scores.length - passed}</strong></div>
      </div>
      <div className="ss-grid">
        <figure className="ss-figure">
          <figcaption>
            <strong>{t("Phổ điểm")}</strong>
            <span className="ss-key"><i className="pass" />{t("Đạt")}</span>
            <span className="ss-key"><i className="fail" />{t("Chưa đạt")}</span>
          </figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} className="ss-hist" role="img" aria-label={t("Phổ điểm: {v}", { v: bins.map((b) => `${b.from}–${b.to}: ${b.students.length}`).join(", ") })}>
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
                  aria-label={t("{from} đến {to} điểm: {n} học sinh", { from: b.from, to: b.to, n })}
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
              <text x={0} y={4} textAnchor="middle" className="ss-mean-text">{t("TB")} {num(m)}</text>
            </g>
          </svg>
          <p className="ss-caption" aria-live="polite">
            {hovered
              ? t("{from}–{v} điểm · {length} học sinh{v2}", { from: hovered.from, v: hovered.to === 10 ? "10" : t("dưới {to}", { to: hovered.to }), length: hovered.students.length, v2: hovered.students.length ? `: ${hovered.students.map((s: Data) => s.full_name.split(" ").at(-1)).join(", ")}` : "" })
              : " "}
          </p>
        </figure>
          <figure className="ss-figure">
            <figcaption><strong>{t("Xếp loại học lực")}</strong></figcaption>
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
              <figcaption>
                <strong>{t("Tỷ lệ đúng theo chủ đề")}</strong>
                <label className="results-select">{t("Sắp xếp")}
                  <select value={topicSort} onChange={e => setTopicSort(e.target.value)}>
                    <option value="low">{t("Tỷ lệ thấp → cao")}</option>
                    <option value="name">{t("Tên chủ đề A–Z")}</option>
                  </select>
                </label>
              </figcaption>
              <ul className="ss-topics">
                {topicRows.map((row) => (
                  <li key={row.topic} className={row.pct < 70 ? "topic-needs-review" : ""}>
                    <span>{row.topic}<small>{row.n}  {t("câu")}</small></span>
                    <div className="ss-topic-track"><i style={{ width: `${row.pct}%` }} /></div>
                    <strong>{Math.round(row.pct)}%</strong>
                  </li>
                ))}
              </ul>
            </figure>
          )}
      {analysis.length > 0 && (
        <div className="ss-items" id="report-questions">
          <div className="ss-items-head">
            <h3>{t("Phân tích câu hỏi")}</h3>
            <div className="item-analysis-toolbar">
            <div className="item-analysis-filters" role="group" aria-label={t("Lọc phân tích câu hỏi")}>
              {[["all", t("Tất cả")], ["low", "<60%"], ["unclassified", t("Chưa phân loại")], ["review", t("Cần xem xét")]].map(([value, label]) => (
                <button type="button" key={value} aria-pressed={itemFilter === value} className={itemFilter === value ? "is-active" : ""} onClick={() => setItemFilter(value)}>{label}</button>
              ))}
            </div>
            <label className="results-select">
              
              {t("Sắp xếp")}
              <select value={itemSort} onChange={(e) => setItemSort(e.target.value)}>
                <option value="order">{t("Theo thứ tự câu")}</option>
                <option value="review">{t("Câu cần xem lại trước")}</option>
                <option value="hard">{t("Câu khó nhất trước")}</option>
              </select>
            </label>
            </div>
          </div>
          <div className="ia-list" role="table" aria-label={t("Phân tích từng câu hỏi")}>
            <div className="ia-row ia-header" role="row">
              <span role="columnheader">{t("Câu")}</span>
              <span role="columnheader">{t("Nội dung và nhận xét")}</span>
              <span role="columnheader">{t("Lựa chọn của lớp")}</span>
              <span role="columnheader">{t("Làm đúng")}</span>
              <span role="columnheader">{t("Phân loại HS")}</span>
              <span role="columnheader">{t("TG trả lời")}</span>
            </div>
            {visibleItems.map(({ q, p, D, flags, severity }) => {
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
                    <details open={compactDistribution ? undefined : true}>
                    <summary>{t("Phân phối lựa chọn")}</summary>
                    <div className="ia-dist-body">
                    <div className="ia-bar" aria-label={counts.map((x) => `${x.c}: ${x.n}`).join(", ") + t(", bỏ trống: {blank}", { blank })}>
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
                    </details>
                  </div>
                  <div className="ia-metric" role="cell">
                    <strong>{Math.round(p * 100)}%</strong>
                    <span className={`level ${dTone}`}>{dLabel}</span>
                  </div>
                  <div className="ia-metric" role="cell">
                    <span className={`quality ${qTone}${D >= 0 && D < 0.2 ? " is-unclassified" : ""}`}>
                      <b aria-hidden="true">{qTone === "good" ? "✓" : qTone === "warn" ? "!" : "✕"}</b>
                      {qLabel}
                    </span>
                  </div>
                  <span className="ia-time" role="cell"><span className="ia-mobile-label">{t("TG trả lời:")} </span>{q.response_ms == null ? "—" : t("{v} giây", { v: num(q.response_ms / 1000) })}</span>
                </div>
              );
            })}
          </div>
          {!visibleItems.length && <p className="analysis-empty" role="status">{t("Không có câu phù hợp bộ lọc.")}</p>}
        </div>
      )}
      <details className="ss-table">
        <summary>{t("Xem bảng số liệu phổ điểm")}</summary>
        <table>
          <thead><tr><th>{t("Khoảng điểm")}</th><th>{t("Số học sinh")}</th><th>{t("Tỷ lệ")}</th></tr></thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.from}>
                <td>{b.from} – {b.to === 10 ? "10" : t("dưới {to}", { to: b.to })}</td>
                <td>{b.students.length}</td>
                <td>{Math.round((b.students.length / scores.length) * 100)}%</td>
              </tr>
            ))}
            <tr><td><b>{t("Trung bình")}</b></td><td colSpan={2}>{fmt(m)}</td></tr>
          </tbody>
        </table>
      </details>
    </section>
  );
}
