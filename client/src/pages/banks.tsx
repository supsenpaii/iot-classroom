import { useState } from "react";
import { api, fields, type Data } from "../api";
import {
  ChoiceShape,
  Empty,
  Field,
  Head,
  Icon,
  Status,
  useApp,
  useResource,
} from "../components";
import { Importer } from "./manage";

const blankQuestion = {
  question: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "A",
  explanation: "",
  topic: "",
  difficulty: "medium",
};
const LETTERS = ["A", "B", "C", "D"];
const difficultyLabel: Record<string, string> = { easy: "Dễ", medium: "Trung bình", hard: "Khó" };
// Each bank gets a stable cover colour from its name, so the list reads like a shelf of quiz covers.
const coverTone = (name: string) => {
  let h = 2166136261; // FNV-1a spreads similar names across all four colours
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ["a", "b", "c", "d"][(h >>> 0) % 4];
};

function Cover({ name, subject }: { name: string; subject?: string }) {
  const label = subject || name;
  return (
    <div className={`bank-cover choice-${coverTone(name)}`} aria-hidden="true">
      <span className={`bank-cover-mark${label.length > 12 ? " is-long" : ""}`}>{label}</span>
      <span className="bank-cover-shapes">
        {LETTERS.map((c) => (
          <ChoiceShape key={c} choice={c} />
        ))}
      </span>
    </div>
  );
}

export function Banks({ id, worksheet }: { id?: string; worksheet?: boolean }) {
  if (id && worksheet) return <Worksheet id={id} />;
  return id ? <BankDetail id={id} /> : <BankList />;
}

function BankList() {
  const banks = useResource<Data[]>("/question-banks"),
    { run } = useApp(),
    [search, setSearch] = useState("");
  return (
    <>
      <Head
        eyebrow="NGÂN HÀNG CÂU HỎI"
        title="Bài giảng hay, từ câu hỏi tốt."
        description="Mỗi bộ đề dùng được cho kiểm tra, flashcard và phiếu bài tập."
      >
        <input
          aria-label="Tìm bộ đề"
          placeholder="Tìm bộ đề hoặc môn học…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Head>
      <div className="bank-layout">
        <div>
          <Status error={banks.error} loading={!banks.data} />
          <div className="bank-grid">
            {banks.data
              ?.filter((b) => (b.name + b.subject).toLowerCase().includes(search.toLowerCase()))
              .map((b) => (
                <a className="bank-card" key={b.id} href={`/question-banks/${b.id}`}>
                  <Cover name={b.name} subject={b.subject} />
                  <div className="bank-card-body">
                    {b.subject && <span className="chip">{b.subject}</span>}
                    <strong>{b.name}</strong>
                    <small>{b.question_count} câu hỏi</small>
                  </div>
                </a>
              ))}
          </div>
          {banks.data?.length === 0 && <Empty>Chưa có bộ đề. Tạo bộ đề rồi nhập XLSX/CSV.</Empty>}
        </div>
        <form
          className="card form bank-side"
          onSubmit={(e) => {
            e.preventDefault();
            const body = fields(e.currentTarget);
            void run(async () => {
              const b = await api("/question-banks", "POST", body);
              window.location.href = `/question-banks/${b.id}`;
            });
          }}
        >
          <h2>Tạo bộ đề</h2>
          <Field label="Tên bộ đề">
            <input name="name" required maxLength={150} placeholder="Ôn tập chương GPIO" />
          </Field>
          <Field label="Môn học">
            <input name="subject" maxLength={100} placeholder="IoT" />
          </Field>
          <button className="primary">+ Tạo bộ đề</button>
        </form>
      </div>
    </>
  );
}

function BankDetail({ id }: { id: string }) {
  const resource = useResource<Data>(`/question-banks/${id}`),
    { run } = useApp(),
    [editing, setEditing] = useState<Data | null>(null),
    [search, setSearch] = useState(""),
    [hideAnswers, setHideAnswers] = useState(false),
    [importOpen, setImportOpen] = useState(false);
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data,
    topics = new Set(d.questions.map((q: Data) => q.topic).filter(Boolean)),
    byLevel = (level: string) => d.questions.filter((q: Data) => q.difficulty === level).length,
    shown = d.questions.filter((q: Data) =>
      (q.question + q.topic + q.option_a + q.option_b + q.option_c + q.option_d)
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const save = (body: Data) =>
    run(async () => {
      await api(
        editing?.id ? `/questions/${editing.id}` : `/question-banks/${id}/questions`,
        editing?.id ? "PATCH" : "POST",
        body,
      );
      setEditing(null);
      resource.reload();
    }, "Đã lưu câu hỏi.");
  return (
    <>
      <a className="bank-back" href="/question-banks">
        ← Tất cả bộ đề
      </a>
      <section className="bank-hero">
        <Cover name={d.name} subject={d.subject} />
        <div className="bank-hero-body">
          <div className="chips">
            {d.subject && <span className="chip">{d.subject}</span>}
            {[...topics].slice(0, 4).map((t) => (
              <span className="chip is-soft" key={String(t)}>{String(t)}</span>
            ))}
          </div>
          <h1>{d.name}</h1>
          <p className="bank-meta">
            <span><Icon name="file" /> {d.questions.length} câu hỏi</span>
            <span className="level easy">{byLevel("easy")} dễ</span>
            <span className="level medium">{byLevel("medium")} trung bình</span>
            <span className="level hard">{byLevel("hard")} khó</span>
          </p>
        </div>
      </section>
      <div className="bank-layout">
        <div className="bank-main">
          <div className="bank-toolbar">
            <div>
              <strong>{d.questions.length} câu hỏi</strong>
              <span className="bank-flags">
                <button
                  role="switch"
                  aria-checked={hideAnswers}
                  className={`switch${hideAnswers ? " is-on" : ""}`}
                  onClick={() => setHideAnswers(!hideAnswers)}
                >
                  <span className="switch-track" aria-hidden="true"><span /></span>
                  Ẩn đáp án
                </button>
              </span>
            </div>
            <input
              aria-label="Tìm câu hỏi"
              placeholder="Tìm câu hỏi, chủ đề…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {importOpen && (
            <section className="card">
              <Importer
                kind="questions"
                onCommit={async (rows) => {
                  await api("/imports/questions/commit", "POST", { bank_id: id, rows });
                  setImportOpen(false);
                  resource.reload();
                }}
              />
            </section>
          )}
          {editing && !editing.id && (
            <QuestionEditor question={editing} onSave={save} onCancel={() => setEditing(null)} />
          )}
          {shown.map((q: Data, i: number) =>
            editing?.id === q.id ? (
              <QuestionEditor key={q.id} question={q} onSave={save} onCancel={() => setEditing(null)} />
            ) : (
              <article className="qcard" key={q.id}>
                <header>
                  <span className="qcard-no"># {d.questions.indexOf(q) + 1}</span>
                  <span className="qcard-type"><Icon name="check" /> Trắc nghiệm</span>
                  {q.topic && <span className="chip is-soft">{q.topic}</span>}
                  <span className={`level ${q.difficulty}`}>{difficultyLabel[q.difficulty] ?? q.difficulty}</span>
                  <span className="qcard-actions">
                    <button className="text-button" onClick={() => setEditing(q)}>Sửa</button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (confirm("Xóa câu hỏi khỏi bộ đề? Các bài đã bắt đầu vẫn giữ bản sao."))
                          void run(async () => {
                            await api(`/questions/${q.id}`, "DELETE");
                            resource.reload();
                          });
                      }}
                    >
                      Xóa
                    </button>
                  </span>
                </header>
                <h3>{q.question}</h3>
                <ul className="qcard-options">
                  {LETTERS.map((c) => {
                    const correct = !hideAnswers && c === q.correct_answer;
                    return (
                      <li key={c} className={correct ? "is-correct" : ""}>
                        <span className="qcard-mark" aria-hidden="true">{correct ? "✓" : ""}</span>
                        <b>{c}</b>
                        <span>{q[`option_${c.toLowerCase()}`]}</span>
                        {correct && <span className="sr-only">(đáp án đúng)</span>}
                      </li>
                    );
                  })}
                </ul>
                {q.explanation && !hideAnswers && <p className="qcard-explain">Lời giải: {q.explanation}</p>}
              </article>
            ),
          )}
          {!d.questions.length && !editing && (
            <Empty>Bộ đề chưa có câu hỏi. Thêm câu hỏi hoặc nhập file XLSX/CSV.</Empty>
          )}
          {d.questions.length > 0 && !shown.length && <Empty>Không có câu hỏi khớp từ khóa.</Empty>}
        </div>
        <aside className="bank-side">
          <a className="button primary bank-primary" href={`/sessions/new?bank=${id}`}>
            ▶ Tạo buổi kiểm tra
          </a>
          <p className="bank-side-label">Soạn và ôn tập</p>
          <button
            className="bank-action"
            onClick={() => {
              setEditing({ ...blankQuestion });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Icon name="file" /> Thêm câu hỏi
          </button>
          <button className="bank-action" onClick={() => setImportOpen(!importOpen)}>
            <Icon name="arrow" /> {importOpen ? "Đóng nhập file" : "Nhập từ Excel/CSV"}
          </button>
          <button
            className="bank-action"
            disabled={!d.questions.length}
            onClick={() =>
              void run(async () => {
                const deck = await api("/flashcard-decks/from-bank", "POST", { bank_id: id });
                window.location.href = `/flashcards/${deck.id}`;
              })
            }
          >
            <Icon name="cards" /> Tạo bộ flashcard
          </button>
          <a className={`button bank-action${d.questions.length ? "" : " is-disabled"}`} href={`/question-banks/${id}/worksheet`}>
            <Icon name="book" /> In phiếu bài tập
          </a>
          <details className="bank-info">
            <summary>Đổi tên, môn học</summary>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const body = fields(e.currentTarget);
                void run(async () => {
                  await api(`/question-banks/${id}`, "PATCH", body);
                  resource.reload();
                }, "Đã cập nhật bộ đề.");
              }}
            >
              <Field label="Tên bộ đề">
                <input name="name" defaultValue={d.name} required maxLength={150} />
              </Field>
              <Field label="Môn học">
                <input name="subject" defaultValue={d.subject} maxLength={100} />
              </Field>
              <button>Lưu thông tin</button>
            </form>
          </details>
        </aside>
      </div>
    </>
  );
}

function QuestionEditor({
  question,
  onSave,
  onCancel,
}: {
  question: Data;
  onSave: (body: Data) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="qcard qcard-editor form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(fields(e.currentTarget));
      }}
    >
      <header>
        <span className="qcard-no">{question.id ? "Sửa câu hỏi" : "Câu hỏi mới"}</span>
      </header>
      <Field label="Nội dung câu hỏi">
        <textarea name="question" defaultValue={question.question} required maxLength={2000} autoFocus />
      </Field>
      <div className="qcard-edit-options">
        {LETTERS.map((c) => (
          <label key={c} className={`poll-input choice-${c.toLowerCase()}`}>
            <b>{c}</b>
            <input
              name={`option_${c.toLowerCase()}`}
              aria-label={`Lựa chọn ${c}`}
              defaultValue={question[`option_${c.toLowerCase()}`]}
              required
              maxLength={500}
            />
          </label>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Đáp án đúng">
          <select name="correct_answer" defaultValue={question.correct_answer}>
            {LETTERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Độ khó">
          <select name="difficulty" defaultValue={question.difficulty}>
            <option value="easy">Dễ</option>
            <option value="medium">Trung bình</option>
            <option value="hard">Khó</option>
          </select>
        </Field>
        <Field label="Chủ đề">
          <input name="topic" defaultValue={question.topic} maxLength={100} placeholder="Ví dụ: GPIO" />
        </Field>
        <Field label="Lời giải (không bắt buộc)">
          <input name="explanation" defaultValue={question.explanation} maxLength={4000} />
        </Field>
      </div>
      <div className="actions">
        <button className="primary">Lưu câu hỏi</button>
        <button type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}

// Printable worksheet: blank answer lines for students, optional answer key on its own page.
function Worksheet({ id }: { id: string }) {
  const resource = useResource<Data>(`/question-banks/${id}`),
    [withKey, setWithKey] = useState(true);
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data;
  return (
    <>
      <div className="worksheet-tools no-print">
        <a className="button" href={`/question-banks/${id}`}>← Về bộ đề</a>
        <label className="check">
          <input type="checkbox" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} />
          Kèm đáp án ở trang cuối
        </label>
        <button className="primary" onClick={() => window.print()}>In / Lưu PDF</button>
      </div>
      <article className="worksheet">
        <header className="worksheet-head">
          <div>
            <p className="eyebrow">{d.subject || "PHIẾU BÀI TẬP"}</p>
            <h1>{d.name}</h1>
            <p>{d.questions.length} câu trắc nghiệm · Khoanh tròn một đáp án đúng</p>
          </div>
          <div className="worksheet-fields">
            <span>Họ và tên: ................................................</span>
            <span>Lớp: ................ Ngày: ....../....../..........</span>
          </div>
        </header>
        <ol className="worksheet-questions">
          {d.questions.map((q: Data) => (
            <li key={q.id}>
              <p>{q.question}</p>
              <ul>
                {LETTERS.map((c) => (
                  <li key={c}>
                    <b>{c}</b> {q[`option_${c.toLowerCase()}`]}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {withKey && (
          <section className="worksheet-key">
            <h2>Đáp án · {d.name}</h2>
            <ol>
              {d.questions.map((q: Data) => (
                <li key={q.id}>
                  <b>{q.correct_answer}</b>
                  {q.explanation && <span> · {q.explanation}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </>
  );
}
