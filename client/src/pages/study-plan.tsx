import { useState } from "react";
import { api, fmt, type Data } from "../api";
import { useApp } from "../components";
import { mastery } from "./results-grid";

type StudyGuide = {
  explanations: Array<{ no: number; explanation: string }>;
  practice: Array<{
    topic: string;
    question: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_answer: string;
    explanation: string;
  }>;
};
const LETTERS = ["A", "B", "C", "D"];
const optionText = (q: Data, c: string) => q.data[`option_${c.toLowerCase()}`];
const topicOf = (q: Data) => (q.data.topic || "").trim() || "Chưa phân loại";
// Models often mark key terms with **bold**; render that instead of showing the asterisks.
const rich = (text: string) =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

// Review plan built from the session's own results; AI wording is an optional extra when a key is configured.
export function StudyPlan({ d, id }: { d: Data; id: string }) {
  const { run, user } = useApp(),
    [who, setWho] = useState("class"),
    [deck, setDeck] = useState<Data | null>(null),
    [aiGuide, setAiGuide] = useState<StudyGuide | null>(null),
    [busy, setBusy] = useState(""),
    [copied, setCopied] = useState(false);
  const scored: Data[] = d.questions.filter((q: Data) => q.status === "CLOSED" && !q.voided);
  const learners: Data[] = d.students
    .filter((s: Data) => !s.absent && s.details.some((a: Data) => a.scored && a.choice !== a.correct_answer))
    .sort((a: Data, b: Data) => (a.score ?? 0) - (b.score ?? 0));
  const student = d.students.find((s: Data) => s.id === who);
  const topicRates = new Map<string, number[]>();
  scored.forEach((q) => topicRates.set(topicOf(q), [...(topicRates.get(topicOf(q)) ?? []), q.correct_rate ?? 0]));
  const classTopics = [...topicRates.entries()]
    .map(([topic, rates]) => ({ topic, pct: rates.reduce((a, b) => a + b, 0) / rates.length }))
    .filter((t) => t.pct < 70)
    .sort((a, b) => a.pct - b.pct);
  const reteach = scored.filter((q) => (q.correct_rate ?? 100) < 60).sort((a, b) => a.correct_rate - b.correct_rate);
  const commonMistake = (q: Data) => {
    const wrong = LETTERS.filter((c) => c !== q.data.correct_answer && (q.counts[c] || 0) > 0).sort(
      (a, b) => q.counts[b] - q.counts[a],
    )[0];
    return wrong ? { c: wrong, n: q.counts[wrong] } : null;
  };
  const missed = student
    ? scored
        .map((q) => ({ q, a: student.details.find((x: Data) => x.question_id === q.id) }))
        .filter(({ a }) => a && a.choice !== a.correct_answer)
    : [];
  const studentTopics = [...new Set(missed.map(({ q }) => topicOf(q)))].map((topic) => ({
    topic,
    wrong: missed.filter(({ q }) => topicOf(q) === topic).length,
    total: scored.filter((q) => topicOf(q) === topic).length,
  }));
  const reviewCount = who === "class" ? reteach.length : missed.length;
  const aiNote = (no: number) => aiGuide?.explanations.find((e) => e.no === no)?.explanation;
  const choose = (value: string) => {
    setWho(value);
    setDeck(null);
    setAiGuide(null);
  };
  const link = deck ? `${location.origin}/study/${deck.share_token}` : "";
  return (
    <section className="card study-plan" aria-label="Gợi ý ôn tập">
      <div className="sp-head">
        <h2>Gợi ý ôn tập</h2>
        <select aria-label="Gợi ý cho" value={who} onChange={(e) => choose(e.target.value)}>
          <option value="class">Cả lớp</option>
          {learners.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} · {fmt(s.score)} điểm
            </option>
          ))}
        </select>
      </div>

      {who === "class" ? (
        <>
          <div className="sp-block">
            <h3>Chủ đề cả lớp còn yếu</h3>
            {classTopics.length ? (
              <div className="sp-topics">
                {classTopics.map((t) => (
                  <span key={t.topic} className={`sp-topic mastery-${mastery(t.pct)}`}>
                    {t.topic}
                    <b>{Math.round(t.pct)}%</b>
                  </span>
                ))}
              </div>
            ) : (
              <p className="sp-empty">Không có chủ đề dưới 70%.</p>
            )}
          </div>
          <div className="sp-block">
            <h3>Câu nên giảng lại <span className="sp-count">{reteach.length}</span></h3>
            {reteach.length ? (
              <ol className="sp-questions">
                {reteach.map((q) => {
                  const mistake = commonMistake(q);
                  return (
                    <li key={q.id}>
                      <div className="sp-q-head">
                        <span className="sp-q-no">Câu {q.question_order}</span>
                        <span className={`pill mastery-${mastery(q.correct_rate)}`}>{Math.round(q.correct_rate)}% đúng</span>
                        <span className="sp-q-topic">{topicOf(q)}</span>
                      </div>
                      <p className="sp-q-text">{q.data.question}</p>
                      <div className="sp-answers">
                        <span className="sp-right"><b>{q.data.correct_answer}</b>{optionText(q, q.data.correct_answer)}</span>
                        {mistake && (
                          <span className="sp-wrong"><b>{mistake.c}</b>{optionText(q, mistake.c)}<em>{mistake.n} bạn chọn</em></span>
                        )}
                      </div>
                      {q.data.explanation && <p className="sp-explain">{q.data.explanation}</p>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="sp-empty">Không có câu cần giảng lại (dưới 60% đúng).</p>
            )}
          </div>
        </>
      ) : student ? (
        <>
          <div className="sp-student">
            <span className={`pill mastery-${mastery(student.score == null ? null : student.score * 10)}`}>{fmt(student.score)} điểm</span>
            <span>Đúng {student.C}/{d.N} câu</span>
            {studentTopics.map((t) => (
              <span key={t.topic} className="sp-topic mastery-low">
                {t.topic}
                <b>sai {t.wrong}/{t.total}</b>
              </span>
            ))}
          </div>
          <div className="sp-block">
            <h3>Câu làm sai <span className="sp-count">{missed.length}</span></h3>
            <ol className="sp-questions">
              {missed.map(({ q, a }) => (
                <li key={q.id}>
                  <div className="sp-q-head">
                    <span className="sp-q-no">Câu {q.question_order}</span>
                    <span className="sp-q-topic">{topicOf(q)}</span>
                    <span className={`sp-tag ${(q.correct_rate ?? 0) >= 70 ? "own" : "shared"}`}>
                      {(q.correct_rate ?? 0) >= 70 ? `lớp ${Math.round(q.correct_rate)}% đúng` : `nhiều bạn cũng sai · lớp ${Math.round(q.correct_rate)}%`}
                    </span>
                  </div>
                  <p className="sp-q-text">{q.data.question}</p>
                  <div className="sp-answers">
                    <span className="sp-wrong">
                      {a.choice ? <><b>{a.choice}</b>{optionText(q, a.choice)}<em>đã chọn</em></> : <em>bỏ trống</em>}
                    </span>
                    <span className="sp-right"><b>{q.data.correct_answer}</b>{optionText(q, q.data.correct_answer)}</span>
                  </div>
                  {q.data.explanation && <p className="sp-explain">{q.data.explanation}</p>}
                  {aiNote(q.question_order) && (
                    <div className="sp-ai-explain">
                      <strong>Giải chi tiết</strong>
                      <p>{rich(aiNote(q.question_order)!)}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : null}

      <div className="sp-actions">
        <button
          className="primary"
          disabled={!!busy || !reviewCount || !!deck}
          onClick={() => {
            setBusy("deck");
            void run(async () => {
              setDeck(await api(`/sessions/${id}/review-deck`, "POST", { student_id: who === "class" ? null : who }));
            }, "Đã tạo bộ flashcard ôn tập.").finally(() => setBusy(""));
          }}
        >
          {busy === "deck" ? "Đang tạo…" : `Tạo bộ flashcard ôn tập (${reviewCount} thẻ)`}
        </button>
        {user.ai && who !== "class" && (
          <button
            disabled={!!busy || !!aiGuide}
            onClick={() => {
              setBusy("ai");
              void run(async () => {
                setAiGuide(await api<StudyGuide>(`/sessions/${id}/study-guide`, "POST", { student_id: who }));
              }).finally(() => setBusy(""));
            }}
          >
            {busy === "ai" ? "AI đang viết…" : "AI giải chi tiết + câu luyện thêm"}
          </button>
        )}
      </div>
      {deck && (
        <div className="sp-deck">
          <strong>Đã tạo bộ {deck.cards} thẻ</strong>
          <a href={`/flashcards/${deck.id}`}>Mở bộ thẻ</a>
          <code>{link}</code>
          <button
            onClick={() =>
              void navigator.clipboard
                ?.writeText(link)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {})
            }
          >
            {copied ? "Đã chép" : "Chép link tự học"}
          </button>
        </div>
      )}
      {aiGuide && (
        <div className="sp-block">
          <h3>Câu luyện thêm <span className="sp-count">{aiGuide.practice.length}</span></h3>
          <ol className="sp-questions">
            {aiGuide.practice.map((p, i) => (
              <li key={i}>
                <div className="sp-q-head">
                  <span className="sp-q-no">Câu {i + 1}</span>
                  {p.topic && <span className="sp-q-topic">{p.topic}</span>}
                </div>
                <p className="sp-q-text">{rich(p.question)}</p>
                <div className="sp-answers">
                  {LETTERS.map((c) => (
                    <span key={c} className={c === p.correct_answer ? "sp-right" : "sp-option"}>
                      <b>{c}</b>
                      {rich(p[`option_${c.toLowerCase()}` as "option_a"])}
                    </span>
                  ))}
                </div>
                <p className="sp-explain">{rich(p.explanation)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
