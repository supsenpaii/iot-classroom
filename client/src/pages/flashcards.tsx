import { useEffect, useRef, useState } from "react";
import { api, fields, type Data } from "../api";
import {
  Empty,
  Field,
  Head,
  Icon,
  Status,
  useApp,
  useResource,
} from "../components";
import { useReviewSocket } from "../socket";
import { Importer } from "./manage";

const percent = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;
const lengthClass = (text: string) =>
  text.length > 280 ? " is-long" : text.length > 120 ? " is-medium" : "";

export function Decks({ id }: { id?: string }) {
  return id ? <Deck id={id} /> : <DeckList />;
}

function DeckList() {
  const decks = useResource<Data[]>("/flashcard-decks"),
    banks = useResource<Data[]>("/question-banks"),
    { run } = useApp(),
    [search, setSearch] = useState("");
  return (
    <>
      <Head
        eyebrow="FLASHCARD"
        title="Nhớ lâu hơn, từng thẻ một."
        description="Ôn tập cả lớp trên màn chiếu với thiết bị ESP32, hoặc gửi link để học sinh tự học trên điện thoại."
      />
      <div className="two-col">
        <section className="card">
          <Field label="Tìm bộ thẻ">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên bộ thẻ hoặc môn học"
            />
          </Field>
          <Status error={decks.error} loading={!decks.data} />
          {decks.data
            ?.filter((d) =>
              (d.name + d.subject).toLowerCase().includes(search.toLowerCase()),
            )
            .map((d) => (
              <a className="list-item" key={d.id} href={`/flashcards/${d.id}`}>
                <Icon name="cards" />
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {d.subject || "Chưa đặt môn học"} · {d.card_count} thẻ
                    {d.share_token ? " · có link tự học" : ""}
                  </small>
                </div>
                {d.running_review && <span className="badge">Đang ôn tập</span>}
                <span>→</span>
              </a>
            ))}
          {decks.data?.length === 0 && (
            <Empty>
              Chưa có bộ thẻ. Tạo bộ thẻ mới hoặc chuyển một bộ đề có sẵn thành
              thẻ.
            </Empty>
          )}
        </section>
        <div>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = fields(e.currentTarget);
              void run(async () => {
                const d = await api("/flashcard-decks", "POST", body);
                window.location.href = `/flashcards/${d.id}`;
              });
            }}
          >
            <h2>Tạo bộ thẻ</h2>
            <Field label="Tên bộ thẻ">
              <input name="name" required maxLength={150} />
            </Field>
            <Field label="Môn học">
              <input name="subject" maxLength={100} />
            </Field>
            <button className="primary">Tạo bộ thẻ</button>
          </form>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = fields(e.currentTarget);
              void run(async () => {
                const d = await api("/flashcard-decks/from-bank", "POST", body);
                window.location.href = `/flashcards/${d.id}`;
              });
            }}
          >
            <h2>Tạo từ ngân hàng câu hỏi</h2>
            <p className="muted">
              Mặt trước là câu hỏi, mặt sau là đáp án đúng kèm lời giải.
            </p>
            <Field label="Bộ đề">
              <select name="bank_id" required disabled={!banks.data?.length}>
                {banks.data?.map((b) => (
                  <option key={b.id} value={b.id} disabled={!b.question_count}>
                    {b.name} · {b.question_count} câu
                  </option>
                ))}
              </select>
            </Field>
            {banks.data?.length === 0 && (
              <small className="muted">Chưa có bộ đề nào.</small>
            )}
            <button disabled={!banks.data?.length}>Tạo bộ thẻ từ bộ đề</button>
          </form>
        </div>
      </div>
    </>
  );
}

function Deck({ id }: { id: string }) {
  const resource = useResource<Data>(`/flashcard-decks/${id}`),
    { run } = useApp(),
    [editing, setEditing] = useState<Data | null>(null),
    [shuffle, setShuffle] = useState(true),
    [copied, setCopied] = useState(false);
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data,
    running = d.reviews.find((r: Data) => r.state === "RUNNING"),
    link = d.share_token ? `${location.origin}/study/${d.share_token}` : "";
  const share = (enabled: boolean) =>
    run(async () => {
      await api(`/flashcard-decks/${id}/share`, "POST", { enabled });
      resource.reload();
    }, enabled ? "Đã tạo link tự học mới." : "Đã tắt link tự học.");
  return (
    <>
      <Head
        eyebrow="BỘ THẺ"
        title={d.name}
        description={`${d.subject || "Chưa đặt môn học"} · ${d.cards.length} thẻ`}
      >
        <a className="button" href="/flashcards">
          ← Tất cả bộ thẻ
        </a>
      </Head>
      <div className="fc-deck-tools">
        <section className="card form">
          <h2>
            <Icon name="device" /> Ôn tập cả lớp
          </h2>
          <p className="muted">
            Chiếu thẻ lên màn hình. Học sinh bấm <b>A = Nhớ</b>,{" "}
            <b>B = Chưa nhớ</b> trên thiết bị; lớp thấy ngay bao nhiêu bạn đã
            nhớ.
          </p>
          {running ? (
            <a className="button primary" href={`/flashcards/review/${running.id}`}>
              Tiếp tục buổi đang ôn →
            </a>
          ) : (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(e) => setShuffle(e.target.checked)}
                />
                Xáo trộn thứ tự thẻ
              </label>
              <button
                className="primary"
                disabled={!d.cards.length}
                onClick={() =>
                  void run(async () => {
                    const r = await api("/flashcard-reviews", "POST", {
                      deck_id: id,
                      shuffle,
                    });
                    window.location.href = `/flashcards/review/${r.id}`;
                  })
                }
              >
                Bắt đầu ôn tập →
              </button>
            </>
          )}
        </section>
        <section className="card form">
          <h2>
            <Icon name="users" /> Link tự học
          </h2>
          {link ? (
            <>
              <p className="muted">
                Học sinh mở link trên điện thoại, không cần tài khoản. Tiến độ
                lưu trên máy của từng bạn.
              </p>
              <div className="fc-share">
                <input readOnly value={link} aria-label="Link tự học" onFocus={(e) => e.target.select()} />
                <button
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(link)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                      .catch(() => {});
                  }}
                >
                  {copied ? "Đã chép" : "Sao chép"}
                </button>
              </div>
              <div className="actions">
                <button onClick={() => void share(true)}>Tạo link mới</button>
                <button className="danger" onClick={() => void share(false)}>
                  Tắt link
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Chưa bật. Khi bật, ai có link đều xem được nội dung bộ thẻ này.
              </p>
              <button
                className="primary"
                disabled={!d.cards.length}
                onClick={() => void share(true)}
              >
                Bật link tự học
              </button>
            </>
          )}
        </section>
      </div>
      <section className="card">
        <Importer
          kind="flashcards"
          onCommit={async (rows) => {
            await api("/imports/flashcards/commit", "POST", { deck_id: id, rows });
            resource.reload();
          }}
        />
      </section>
      <div className="row spread">
        <h2>Thẻ trong bộ</h2>
        <button className="primary" onClick={() => setEditing({ front: "", back: "" })}>
          + Thêm thẻ
        </button>
      </div>
      {editing && (
        <form
          className="card form fc-editor"
          key={editing.id || "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const body = fields(e.currentTarget);
            void run(async () => {
              await api(
                editing.id
                  ? `/flashcards/${editing.id}`
                  : `/flashcard-decks/${id}/cards`,
                editing.id ? "PATCH" : "POST",
                body,
              );
              setEditing(editing.id ? null : { front: "", back: "" });
              resource.reload();
            }, "Đã lưu thẻ.");
          }}
        >
          <h2>{editing.id ? "Sửa thẻ" : "Thêm thẻ"}</h2>
          <div className="form-grid">
            <Field label="Mặt trước (câu hỏi, thuật ngữ)">
              <textarea name="front" defaultValue={editing.front} required maxLength={2000} />
            </Field>
            <Field label="Mặt sau (đáp án, giải thích)">
              <textarea name="back" defaultValue={editing.back} required maxLength={5000} />
            </Field>
          </div>
          <div className="actions">
            <button className="primary">Lưu thẻ</button>
            <button type="button" onClick={() => setEditing(null)}>
              Đóng
            </button>
          </div>
        </form>
      )}
      {d.cards.length ? (
        <div className="fc-grid">
          {d.cards.map((c: Data, i: number) => (
            <article className="card fc-item" key={c.id}>
              <div className="row spread">
                <span className="badge">Thẻ {i + 1}</span>
                <div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(c);
                      setTimeout(
                        () =>
                          document
                            .querySelector(".fc-editor")
                            ?.scrollIntoView({ block: "center" }),
                        0,
                      );
                    }}
                  >
                    Sửa
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (confirm("Xóa thẻ này khỏi bộ thẻ?"))
                        void run(async () => {
                          await api(`/flashcards/${c.id}`, "DELETE");
                          resource.reload();
                        });
                    }}
                  >
                    Xóa
                  </button>
                </div>
              </div>
              <h3>{c.front}</h3>
              <p className="fc-back-text">{c.back}</p>
            </article>
          ))}
        </div>
      ) : (
        <Empty>Bộ thẻ chưa có thẻ. Thêm thẻ hoặc nhập file XLSX/CSV.</Empty>
      )}
      {d.reviews.length > 0 && (
        <section className="card">
          <h2>Các buổi ôn tập</h2>
          {d.reviews.map((r: Data) => (
            <a className="list-item" key={r.id} href={`/flashcards/review/${r.id}`}>
              <div>
                <strong>{new Date(r.created_at).toLocaleString("vi-VN")}</strong>
                <small>{r.round} vòng</small>
              </div>
              <span className="badge">
                {r.state === "RUNNING" ? "Đang ôn tập" : "Đã kết thúc"}
              </span>
              <span>→</span>
            </a>
          ))}
        </section>
      )}
      <div className="two-col">
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            const body = fields(e.currentTarget);
            void run(async () => {
              await api(`/flashcard-decks/${id}`, "PATCH", body);
              resource.reload();
            }, "Đã cập nhật bộ thẻ.");
          }}
        >
          <h3>Thông tin bộ thẻ</h3>
          <Field label="Tên bộ thẻ">
            <input name="name" defaultValue={d.name} required maxLength={150} />
          </Field>
          <Field label="Môn học">
            <input name="subject" defaultValue={d.subject} maxLength={100} />
          </Field>
          <button>Lưu thông tin</button>
        </form>
        <section className="card form">
          <h3>Xóa bộ thẻ</h3>
          <p className="muted">
            Xóa luôn các thẻ và lịch sử ôn tập. Link tự học sẽ ngừng hoạt động.
          </p>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Xóa bộ thẻ "${d.name}"? Không thể hoàn tác.`))
                void run(async () => {
                  await api(`/flashcard-decks/${id}`, "DELETE");
                  window.location.href = "/flashcards";
                });
            }}
          >
            Xóa bộ thẻ
          </button>
        </section>
      </div>
    </>
  );
}

export function FlashcardReview({ id }: { id: string }) {
  const { run } = useApp(),
    { data, status, setData } = useReviewSocket(id),
    [busy, setBusy] = useState(false),
    stage = useRef<HTMLDivElement>(null);
  const command = (action: string) => {
    if (busy) return;
    setBusy(true);
    void run(async () => {
      const next = await api(`/flashcard-reviews/${id}/commands`, "POST", { action });
      setData((old) =>
        !old || next.state_version >= old.state_version ? next : old,
      );
    }).finally(() => setBusy(false));
  };
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key === " " || e.key === "Enter") {
        if (tag === "BUTTON") return; // the focused button handles it natively
        e.preventDefault();
        commandRef.current("flip");
      } else if (e.key === "ArrowRight") commandRef.current("next");
      else if (e.key === "ArrowLeft") commandRef.current("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!data)
    return <Status loading={!status.startsWith("Không")} error={status.startsWith("Không") ? status : undefined} />;
  if (data.state === "FINISHED") return <ReviewSummary data={data} />;
  const rated = data.counts.KNOWN + data.counts.AGAIN,
    waiting = Math.max(0, data.devices_online - rated),
    last = data.index === data.total - 1,
    againCards = data.round_stats.filter((c: Data) => c.AGAIN > 0).length;
  return (
    <div className="fc-review" ref={stage}>
      <header className="fc-review-head">
        <div>
          <p className="eyebrow">
            ÔN TẬP CẢ LỚP · VÒNG {data.round} · {status.toUpperCase()}
          </p>
          <h1>{data.deck_name}</h1>
        </div>
        <div className="actions">
          <button
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void stage.current?.requestFullscreen().catch(() => {});
            }}
          >
            Toàn màn hình
          </button>
          <button
            className="danger"
            onClick={() => {
              if (confirm("Kết thúc buổi ôn tập? Thiết bị sẽ ngừng nhận thẻ."))
                command("finish");
            }}
          >
            Kết thúc
          </button>
        </div>
      </header>
      <div className="fc-review-body">
        <section className="fc-stage">
          <div className="fc-progress">
            <span>
              Thẻ <b>{data.index + 1}</b>/{data.total}
            </span>
            <div className="fc-progress-track" aria-hidden="true">
              <span style={{ width: `${((data.index + 1) / data.total) * 100}%` }} />
            </div>
          </div>
          <button
            className={`fc-card${data.side === "back" ? " is-flipped" : ""}`}
            onClick={() => command("flip")}
            aria-label={data.side === "back" ? "Lật về mặt trước" : "Lật xem mặt sau"}
          >
            <span className="fc-face fc-front">
              <small>MẶT TRƯỚC</small>
              <span className={`fc-text${lengthClass(data.card.front)}`}>{data.card.front}</span>
            </span>
            <span className="fc-face fc-back">
              <small>MẶT SAU</small>
              <span className={`fc-text${lengthClass(data.card.back)}`}>{data.card.back}</span>
            </span>
          </button>
          <div className="fc-controls">
            <button disabled={busy || data.index === 0} onClick={() => command("prev")}>
              ← Thẻ trước
            </button>
            <button className="primary" disabled={busy} onClick={() => command("flip")}>
              {data.side === "back" ? "Lật lại" : "Lật thẻ"} <kbd>Space</kbd>
            </button>
            {last ? (
              againCards > 0 ? (
                <button className="primary fc-sun" disabled={busy} onClick={() => command("repeat")}>
                  Ôn lại {againCards} thẻ chưa nhớ ↻
                </button>
              ) : (
                <button disabled={busy} onClick={() => command("finish")}>
                  Hoàn thành buổi ôn ✓
                </button>
              )
            ) : (
              <button disabled={busy} onClick={() => command("next")}>
                Thẻ tiếp →
              </button>
            )}
          </div>
        </section>
        <aside className="fc-live card">
          <h2>Lớp tự đánh giá</h2>
          <div className="fc-tally">
            <div className="fc-known">
              <strong>{data.counts.KNOWN}</strong>
              <small>Nhớ · phím A</small>
            </div>
            <div className="fc-again">
              <strong>{data.counts.AGAIN}</strong>
              <small>Chưa nhớ · phím B</small>
            </div>
            <div className="fc-waiting">
              <strong>{waiting}</strong>
              <small>Chưa bấm</small>
            </div>
          </div>
          <div className="stacked-bar" aria-label={`${data.counts.KNOWN} nhớ, ${data.counts.AGAIN} chưa nhớ`}>
            <span className="correct" style={{ width: `${percent(data.counts.KNOWN, Math.max(rated, data.devices_online))}%` }} />
            <span className="wrong" style={{ width: `${percent(data.counts.AGAIN, Math.max(rated, data.devices_online))}%` }} />
          </div>
          <p className="muted">
            {data.devices_online} thiết bị đang kết nối
            {data.devices_online === 0 && " · bật thiết bị hoặc mở trang Giả lập để thử"}
          </p>
          <h3>Vòng {data.round}</h3>
          <ol className="fc-round">
            {data.round_stats.map((c: Data) => (
              <li key={c.id} className={c.position === data.index + 1 ? "is-current" : ""}>
                <span>{c.front}</span>
                <small>
                  <b className="green">{c.KNOWN}</b> / <b className="fc-again-text">{c.AGAIN}</b>
                </small>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function ReviewSummary({ data }: { data: Data }) {
  const rows = [...data.summary].sort(
    (a: Data, b: Data) =>
      percent(a.last.KNOWN, a.last.KNOWN + a.last.AGAIN) -
      percent(b.last.KNOWN, b.last.KNOWN + b.last.AGAIN),
  );
  return (
    <>
      <Head
        eyebrow={`ÔN TẬP CẢ LỚP · ${data.round} VÒNG · ĐÃ KẾT THÚC`}
        title={data.deck_name}
        description="Thẻ khó nhất ở trên cùng. Tỷ lệ tính trên số thiết bị đã bấm ở mỗi vòng."
      >
        <a className="button" href={`/flashcards/${data.deck_id}`}>
          ← Về bộ thẻ
        </a>
      </Head>
      <section className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mặt trước</th>
                <th>Lần đầu nhớ</th>
                <th>Lần cuối nhớ</th>
                <th>Số vòng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: Data) => {
                const first = c.first.KNOWN + c.first.AGAIN,
                  last = c.last.KNOWN + c.last.AGAIN;
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.front}</strong>
                      <small>{c.back}</small>
                    </td>
                    <td>{first ? `${percent(c.first.KNOWN, first)}% (${c.first.KNOWN}/${first})` : "—"}</td>
                    <td>{last ? `${percent(c.last.KNOWN, last)}% (${c.last.KNOWN}/${last})` : "—"}</td>
                    <td>{c.rounds || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type Progress = {
  queue: string[];
  known: string[];
  misses: Record<string, number>;
};
function shuffle<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
// Self-study: no account, progress lives in this browser only.
export function Study({ token }: { token: string }) {
  const key = `flashcards:${token}`,
    [deck, setDeck] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<Progress | null>(null),
    [flipped, setFlipped] = useState(false);
  useEffect(() => {
    api(`/public/flashcards/${token}`)
      .then((d) => {
        setDeck(d);
        const ids: string[] = d.cards.map((c: Data) => c.id);
        let saved: Progress | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(key) || "null");
        } catch {
          saved = null;
        }
        if (saved?.queue && saved.known && saved.misses) {
          const valid = new Set(ids),
            seen = new Set([...saved.queue, ...saved.known]);
          setProgress({
            queue: [
              ...saved.queue.filter((x) => valid.has(x)),
              ...ids.filter((x) => !seen.has(x)),
            ],
            known: saved.known.filter((x) => valid.has(x)),
            misses: saved.misses,
          });
        } else setProgress({ queue: shuffle(ids), known: [], misses: {} });
      })
      .catch((e) => setError(e.message));
  }, [token, key]);
  useEffect(() => {
    if (!progress) return;
    try {
      localStorage.setItem(key, JSON.stringify(progress));
    } catch {
      /* private mode: progress simply is not kept */
    }
  }, [key, progress]);
  const rate = (knew: boolean) => {
    setFlipped(false);
    setProgress((p) => {
      if (!p || !p.queue.length) return p;
      const [id, ...rest] = p.queue;
      if (knew) return { ...p, queue: rest, known: [...p.known, id] };
      // Bring a forgotten card back after a few others instead of immediately.
      const at = Math.min(3, rest.length);
      return {
        ...p,
        queue: [...rest.slice(0, at), id, ...rest.slice(at)],
        misses: { ...p.misses, [id]: (p.misses[id] || 0) + 1 },
      };
    });
  };
  const rateRef = useRef(rate);
  rateRef.current = rate;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        if ((e.target as HTMLElement).tagName === "BUTTON") return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "1") rateRef.current(false);
      else if (e.key === "2") rateRef.current(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (error)
    return (
      <main className="study">
        <Status error={error} />
      </main>
    );
  if (!deck || !progress)
    return (
      <main className="study">
        <Status loading />
      </main>
    );
  const byId = new Map<string, Data>(deck.cards.map((c: Data) => [c.id, c])),
    total = deck.cards.length,
    card = byId.get(progress.queue[0]),
    hardest = Object.entries(progress.misses)
      .filter(([cardId]) => byId.has(cardId))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  return (
    <main className="study">
      <header className="study-head">
        <p className="eyebrow">TỰ HỌC · {deck.subject || "FLASHCARD"}</p>
        <h1>{deck.name}</h1>
        <div className="fc-progress">
          <span>
            Đã nhớ <b>{progress.known.length}</b>/{total}
          </span>
          <div className="fc-progress-track" aria-hidden="true">
            <span style={{ width: `${percent(progress.known.length, total)}%` }} />
          </div>
        </div>
      </header>
      {card ? (
        <>
          <button
            className={`fc-card study-card${flipped ? " is-flipped" : ""}`}
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Lật về mặt trước" : "Lật xem mặt sau"}
          >
            <span className="fc-face fc-front">
              <small>MẶT TRƯỚC · CHẠM ĐỂ LẬT</small>
              <span className={`fc-text${lengthClass(card.front)}`}>{card.front}</span>
            </span>
            <span className="fc-face fc-back">
              <small>MẶT SAU</small>
              <span className={`fc-text${lengthClass(card.back)}`}>{card.back}</span>
            </span>
          </button>
          {flipped ? (
            <div className="study-rate">
              <button className="fc-rate-again" onClick={() => rate(false)}>
                Chưa nhớ
                <small>xem lại sau</small>
              </button>
              <button className="fc-rate-known" onClick={() => rate(true)}>
                Đã nhớ
                <small>bỏ khỏi lượt này</small>
              </button>
            </div>
          ) : (
            <p className="study-hint">
              Nhớ lại đáp án trong đầu, rồi chạm thẻ để kiểm tra.
            </p>
          )}
          <p className="study-meta">Còn {progress.queue.length} thẻ trong lượt này</p>
        </>
      ) : (
        <section className="card study-done">
          <h2>Hoàn thành! Thuộc cả {total} thẻ.</h2>
          <p className="muted">
            {hardest.length
              ? `Bạn đã quên tổng cộng ${Object.values(progress.misses).reduce((a, b) => a + b, 0)} lần. Các thẻ cần ôn thêm:`
              : "Không quên thẻ nào. Rất tốt!"}
          </p>
          {hardest.length > 0 && (
            <ul className="study-hardest">
              {hardest.map(([cardId, n]) => (
                <li key={cardId}>
                  <span>{byId.get(cardId)!.front}</span>
                  <small>quên {n} lần</small>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            {hardest.length > 0 && (
              <button
                className="primary"
                onClick={() =>
                  setProgress({
                    queue: shuffle(
                      Object.keys(progress.misses).filter((x) => byId.has(x)),
                    ),
                    known: progress.known.filter((x) => !progress.misses[x]),
                    misses: {},
                  })
                }
              >
                Ôn lại thẻ từng quên
              </button>
            )}
            <button
              onClick={() =>
                setProgress({
                  queue: shuffle(deck.cards.map((c: Data) => c.id)),
                  known: [],
                  misses: {},
                })
              }
            >
              Học lại từ đầu
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
