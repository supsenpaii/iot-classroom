import { useLayoutEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";
import { api, fmt, type Data } from "../api";
import { useApp } from "../components";
import { mastery } from "./results-grid";
import { createStudyRequests } from "./study-plan-requests";
import type { Choice, QuestionOptionKey, StudyGuideResult } from "../../../shared/protocol";
import { getLang, locale, t } from "../i18n";

type ReviewDeck = { id: string; share_token: string; cards: number };
const LETTERS: Choice[] = ["A", "B", "C", "D"];
const optionText = (q: Data, c: Choice) => q.data[`option_${c.toLowerCase()}` as QuestionOptionKey];
const topicOf = (q: Data) => (q.data.topic || "").trim() || t("Chưa phân loại");
// Models often mark key terms with **bold**; render that instead of showing the asterisks.
const rich = (text: string) =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

// Review plan built from the session's own results; AI wording is an optional extra when a key is configured.
export function StudyPlan({ d, id }: { d: Data; id: string }) {
  return <StudyPlanContent key={id} d={d} id={id} />;
}
function StudyPlanContent({ d, id }: { d: Data; id: string }) {
  const { run, user } = useApp(),
    [who, setWho] = useState("class"),
    [deck, setDeck] = useState<ReviewDeck | null>(null),
    // Guides saved on the server arrive with the report; new ones are added as they are made.
    [guides, setGuides] = useState<Record<string, StudyGuideResult>>(d.study_guides ?? {}),
    [practiceCount, setPracticeCount] = useState(3),
    [practiceDeck, setPracticeDeck] = useState<ReviewDeck | null>(null),
    [busy, setBusy] = useState({ deck: false, ai: false, practice: false }),
    [copied, setCopied] = useState(false);
  const aiGuide = guides[who] ?? null;
  const requests = useRef(createStudyRequests(id, "class"));
  useLayoutEffect(() => {
    const current = requests.current;
    current.mount();
    return () => current.unmount();
  }, []);
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
    requests.current.select(id, value);
    setWho(value);
    setDeck(null);
    setPracticeDeck(null);
    setBusy({ deck: false, ai: false, practice: false });
    setCopied(false);
  };
  const link = deck ? `${location.origin}/study/${deck.share_token}` : "";
  const practiceLink = practiceDeck ? `${location.origin}/study/${practiceDeck.share_token}` : "";
  const generate = (regenerate: boolean) => {
    const request = requests.current.begin("ai");
    setBusy(old => ({ ...old, ai: true }));
    // Defaults stay out of the payload so the request is the same as before these options existed.
    const body: Record<string, unknown> = { student_id: request.studentId };
    if (regenerate) body.regenerate = true;
    if (getLang() === "en") body.lang = "en";
    if (practiceCount !== 3) body.practice_count = practiceCount;
    void run(async () => {
      const guide = await api<StudyGuideResult>(`/sessions/${request.sessionId}/study-guide`, "POST", body);
      if (request.isCurrent()) {
        setGuides(old => ({ ...old, [request.studentId]: guide }));
        setPracticeDeck(null);
      }
    }, "", request).finally(() => {
      if (request.isCurrent()) setBusy(old => ({ ...old, ai: false }));
    });
  };
  return (
    <section className="card study-plan" aria-label={t("Gợi ý ôn tập")}>
      <div className="sp-head">
        <h2>{t("Gợi ý ôn tập")}</h2>
        <select aria-label={t("Gợi ý cho")} value={who} onChange={(e) => choose(e.target.value)}>
          <option value="class">{t("Cả lớp")}</option>
          {learners.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} · {fmt(s.score)}  {t("điểm")}
            </option>
          ))}
        </select>
      </div>

      {who === "class" ? (
        <>
          <div className="sp-block">
            <h3>{t("Chủ đề cả lớp còn yếu")}</h3>
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
              <p className="sp-empty">{t("Không có chủ đề dưới 70%.")}</p>
            )}
          </div>
          <div className="sp-block">
            <h3>{t("Câu nên giảng lại")} <span className="sp-count">{reteach.length}</span></h3>
            {reteach.length ? (
              <ol className="sp-questions">
                {reteach.map((q) => {
                  const mistake = commonMistake(q);
                  return (
                    <li key={q.id}>
                      <div className="sp-q-head">
                        <span className="sp-q-no">{t("Câu")} {q.question_order}</span>
                        <span className={`pill mastery-${mastery(q.correct_rate)}`}>{Math.round(q.correct_rate)}{t("% đúng")}</span>
                        <span className="sp-q-topic">{topicOf(q)}</span>
                      </div>
                      <p className="sp-q-text">{q.data.question}</p>
                      <div className="sp-answers">
                        <span className="sp-right"><b>{q.data.correct_answer}</b>{optionText(q, q.data.correct_answer)}</span>
                        {mistake && (
                          <span className="sp-wrong"><b>{mistake.c}</b>{optionText(q, mistake.c)}<em>{mistake.n}  {t("bạn chọn")}</em></span>
                        )}
                      </div>
                      {q.data.explanation && <p className="sp-explain">{q.data.explanation}</p>}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="sp-empty">{t("Không có câu cần giảng lại (dưới 60% đúng).")}</p>
            )}
          </div>
        </>
      ) : student ? (
        <>
          <div className="sp-student">
            <span className={`pill mastery-${mastery(student.score == null ? null : student.score * 10)}`}>{fmt(student.score)}  {t("điểm")}</span>
            <span>{t("Đúng")} {student.C}/{d.N}  {t("câu")}</span>
            {studentTopics.map((topic) => (
              <span key={topic.topic} className="sp-topic mastery-low">
                {topic.topic}
                <b>{t("sai")} {topic.wrong}/{topic.total}</b>
              </span>
            ))}
          </div>
          <div className="sp-block">
            <h3>{t("Câu làm sai")} <span className="sp-count">{missed.length}</span></h3>
            <ol className="sp-questions">
              {missed.map(({ q, a }) => (
                <li key={q.id}>
                  <div className="sp-q-head">
                    <span className="sp-q-no">{t("Câu")} {q.question_order}</span>
                    <span className="sp-q-topic">{topicOf(q)}</span>
                    <span className={`sp-tag ${(q.correct_rate ?? 0) >= 70 ? "own" : "shared"}`}>
                      {(q.correct_rate ?? 0) >= 70 ? t("lớp {v}% đúng", { v: Math.round(q.correct_rate) }) : t("nhiều bạn cũng sai · lớp {v}%", { v: Math.round(q.correct_rate) })}
                    </span>
                  </div>
                  <p className="sp-q-text">{q.data.question}</p>
                  <div className="sp-answers">
                    <span className="sp-wrong">
                      {a.choice ? <><b>{a.choice}</b>{optionText(q, a.choice)}<em>{t("đã chọn")}</em></> : <em>{t("bỏ trống")}</em>}
                    </span>
                    <span className="sp-right"><b>{q.data.correct_answer}</b>{optionText(q, q.data.correct_answer)}</span>
                  </div>
                  {q.data.explanation && <p className="sp-explain">{q.data.explanation}</p>}
                  {aiNote(q.question_order) && (
                    <div className="sp-ai-explain">
                      <strong>{t("Giải chi tiết")}</strong>
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
          disabled={busy.deck || !reviewCount || !!deck}
          onClick={() => {
            const request = requests.current.begin("deck");
            setBusy(old => ({ ...old, deck: true }));
            void run(async () => {
              const deck = await api<ReviewDeck>(`/sessions/${request.sessionId}/review-deck`, "POST", {
                student_id: request.studentId === "class" ? null : request.studentId,
              });
              if (request.isCurrent()) setDeck(deck);
            }, t("Đã tạo bộ flashcard ôn tập."), request).finally(() => {
              if (request.isCurrent()) setBusy(old => ({ ...old, deck: false }));
            });
          }}
        >
          {busy.deck ? t("Đang tạo…") : t("Tạo bộ flashcard ôn tập ({reviewCount} thẻ)", { reviewCount })}
        </button>
        {user.ai && who !== "class" && (
          <>
            {!aiGuide && (
              <label className="sp-count-field">
                {t("Số câu luyện thêm")}
                <select value={practiceCount} onChange={(e) => setPracticeCount(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            <button disabled={busy.ai} onClick={() => generate(!!aiGuide)}>
              {busy.ai ? t("AI đang viết…") : aiGuide ? t("Tạo lại") : t("AI giải chi tiết + câu luyện thêm")}
            </button>
          </>
        )}
      </div>
      {deck && (
        <div className="sp-deck">
          <strong>{t("Đã tạo bộ")} {deck.cards}  {t("thẻ")}</strong>
          <a href={`/flashcards/${deck.id}`}>{t("Mở bộ thẻ")}</a>
          <code>{link}</code>
          <button
            onClick={() => {
              const request = requests.current.begin("copy");
              void run(async () => {
                await copyText(link);
                if (request.isCurrent()) {
                  setCopied(true);
                  setTimeout(() => {
                    if (request.isCurrent()) setCopied(false);
                  }, 1500);
                }
              }, "", request);
            }}
          >
            {copied ? t("Đã chép") : t("Chép link tự học")}
          </button>
        </div>
      )}
      {aiGuide && (
        <div className="sp-block">
          <h3>{t("Câu luyện thêm")} <span className="sp-count">{aiGuide.practice.length}</span></h3>
          <p className="sp-help">
            {t("AI có thể sai. Hãy kiểm tra trước khi dùng với lớp.")}
            {aiGuide.model && aiGuide.created_at
              ? ` ${t("Tạo bởi {model} lúc {time}", {
                  model: aiGuide.model,
                  time: new Date(aiGuide.created_at).toLocaleString(locale()),
                })}`
              : ""}
          </p>
          <ol className="sp-questions">
            {aiGuide.practice.map((p, i) => (
              <li key={i}>
                <div className="sp-q-head">
                  <span className="sp-q-no">{t("Câu")} {i + 1}</span>
                  {p.topic && <span className="sp-q-topic">{p.topic}</span>}
                </div>
                <p className="sp-q-text">{rich(p.question)}</p>
                <div className="sp-answers">
                  {LETTERS.map((c) => (
                    <span key={c} className={c === p.correct_answer ? "sp-right" : "sp-option"}>
                      <b>{c}</b>
                      {rich(p[`option_${c.toLowerCase()}` as QuestionOptionKey])}
                    </span>
                  ))}
                </div>
                <p className="sp-explain">{rich(p.explanation)}</p>
              </li>
            ))}
          </ol>
          <div className="sp-actions">
            <button
              disabled={busy.practice || !!practiceDeck}
              onClick={() => {
                const request = requests.current.begin("practice");
                setBusy(old => ({ ...old, practice: true }));
                void run(async () => {
                  const created = await api<ReviewDeck>(`/sessions/${request.sessionId}/study-guide/deck`, "POST", { student_id: request.studentId });
                  if (request.isCurrent()) setPracticeDeck(created);
                }, t("Đã tạo link luyện thêm."), request).finally(() => {
                  if (request.isCurrent()) setBusy(old => ({ ...old, practice: false }));
                });
              }}
            >
              {busy.practice ? t("Đang tạo…") : t("Tạo link luyện thêm cho học sinh")}
            </button>
          </div>
          {practiceDeck && (
            <div className="sp-deck">
              <strong>{t("Đã tạo bộ")} {practiceDeck.cards}  {t("thẻ")}</strong>
              <a href={`/flashcards/${practiceDeck.id}`}>{t("Mở bộ thẻ")}</a>
              <code>{practiceLink}</code>
              <button onClick={() => void run(() => copyText(practiceLink), t("Đã chép"))}>{t("Chép link tự học")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
