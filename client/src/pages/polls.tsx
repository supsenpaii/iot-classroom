import { useRef, useState } from "react";
import { api, type Data } from "../api";
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
import { useActivitySocket } from "../socket";

const TEMPLATES = [
  {
    label: "Hiểu bài chưa?",
    question: "Em hiểu phần vừa học đến đâu?",
    options: ["Hiểu rõ, tự làm được", "Hiểu sơ, cần thêm ví dụ", "Chưa hiểu lắm", "Cần giảng lại"],
  },
  {
    label: "Tốc độ giảng",
    question: "Tốc độ giảng bài hôm nay thế nào?",
    options: ["Quá nhanh", "Vừa phải", "Hơi chậm"],
  },
  {
    label: "Phiếu cuối giờ",
    question: "Buổi học hôm nay em thấy thế nào?",
    options: ["Rất thích, dễ hiểu", "Ổn", "Hơi khó theo", "Cần ôn lại cả bài"],
  },
  { label: "Đúng / Sai", question: "", options: ["Đúng", "Sai"] },
];
const KEYS = ["A", "B", "C", "D"];

export function Polls({ id }: { id?: string }) {
  return id ? <PollLive id={id} /> : <PollHome />;
}

function PollHome() {
  const list = useResource<Data[]>("/polls"),
    { run } = useApp(),
    [question, setQuestion] = useState(""),
    [options, setOptions] = useState(["", "", "", ""]),
    [hide, setHide] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  return (
    <>
      <Head
        eyebrow="KHẢO SÁT NHANH"
        title="Hỏi cả lớp trong mười giây."
        description="Học sinh bấm A–D trên thiết bị, ẩn danh. Kết quả hiện ngay trên màn chiếu."
      />
      <div className="two-col">
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const p = await api("/polls", "POST", {
                question,
                options: filled,
                hide_results: hide,
              });
              window.location.href = `/polls/${p.id}`;
            });
          }}
        >
          <h2>Tạo khảo sát</h2>
          <div className="poll-templates" role="group" aria-label="Mẫu có sẵn">
            {TEMPLATES.map((t) => (
              <button
                type="button"
                key={t.label}
                onClick={() => {
                  if (t.question) setQuestion(t.question);
                  setOptions([...t.options, "", "", ""].slice(0, 4));
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Field label="Câu hỏi">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
              maxLength={300}
              placeholder="Ví dụ: Em muốn ôn lại phần nào?"
            />
          </Field>
          <div className="poll-inputs">
            {KEYS.map((k, i) => (
              <label key={k} className={`poll-input choice-${k.toLowerCase()}`}>
                <b>{k}</b>
                <input
                  aria-label={`Lựa chọn ${k}`}
                  value={options[i]}
                  maxLength={120}
                  required={i < 2}
                  placeholder={i < 2 ? "Bắt buộc" : "Không bắt buộc"}
                  onChange={(e) =>
                    setOptions((o) => o.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />
            Ẩn kết quả đến khi giáo viên bấm hiện (tránh học sinh chọn theo số đông)
          </label>
          <button className="primary" disabled={!question.trim() || filled.length < 2}>
            Bắt đầu khảo sát →
          </button>
        </form>
        <section className="card">
          <h2>Các khảo sát gần đây</h2>
          <Status error={list.error} loading={!list.data} />
          {list.data?.map((p) => (
            <a className="list-item" key={p.id} href={`/polls/${p.id}`}>
              <Icon name="chart" />
              <div>
                <strong>{p.question}</strong>
                <small>
                  {new Date(p.created_at).toLocaleString("vi-VN")} · {p.votes} ý kiến
                </small>
              </div>
              <span className="badge">{p.state === "RUNNING" ? "Đang mở" : "Đã đóng"}</span>
              <span>→</span>
            </a>
          ))}
          {list.data?.length === 0 && (
            <Empty>Chưa có khảo sát. Chọn một mẫu bên cạnh để bắt đầu.</Empty>
          )}
        </section>
      </div>
    </>
  );
}

function PollLive({ id }: { id: string }) {
  const { run } = useApp(),
    { data, status, setData } = useActivitySocket("poll_id", "poll", id),
    [busy, setBusy] = useState(false),
    stage = useRef<HTMLDivElement>(null);
  const command = (action: string) => {
    if (busy) return;
    setBusy(true);
    void run(async () => {
      const next = await api(`/polls/${id}/commands`, "POST", { action });
      setData((old) => (!old || next.state_version >= old.state_version ? next : old));
    }).finally(() => setBusy(false));
  };
  if (!data)
    return (
      <Status
        loading={!status.startsWith("Không")}
        error={status.startsWith("Không") ? status : undefined}
      />
    );
  const open = data.state === "RUNNING",
    hidden = open && data.hide_results,
    max = Math.max(1, ...data.options.map((o: Data) => o.count));
  return (
    <div className="poll-live" ref={stage}>
      <header className="fc-review-head">
        <div>
          <p className="eyebrow">
            KHẢO SÁT NHANH · ẨN DANH · {open ? "ĐANG NHẬN Ý KIẾN" : "ĐÃ ĐÓNG"} · {status.toUpperCase()}
          </p>
          <h1>{data.question}</h1>
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
          {hidden && (
            <button className="primary" disabled={busy} onClick={() => command("reveal")}>
              Hiện kết quả
            </button>
          )}
          {open ? (
            <button className="danger" disabled={busy} onClick={() => command("close")}>
              Đóng khảo sát
            </button>
          ) : (
            <a className="button primary" href="/polls">
              Khảo sát mới
            </a>
          )}
        </div>
      </header>
      <p className="poll-meta">
        <strong>{data.total_votes}</strong> ý kiến · {data.devices_online} thiết bị đang kết nối
        {open && ` · Bấm ${data.options.map((o: Data) => o.key).join(", ")} trên thiết bị`}
      </p>
      <div className="poll-options">
        {data.options.map((o: Data) => {
          const pct = data.total_votes ? Math.round((o.count / data.total_votes) * 100) : 0;
          return (
            <div key={o.key} className={`poll-option choice-${o.key.toLowerCase()}`}>
              <b>{o.key}</b>
              <div className="poll-body">
                <span className="poll-label">{o.label}</span>
                <div className="poll-track" aria-hidden="true">
                  <span style={{ width: hidden ? 0 : `${(o.count / max) * 100}%` }} />
                </div>
              </div>
              <ChoiceShape choice={o.key} />
              <strong className="poll-count">
                {hidden ? "?" : `${pct}%`}
                <small>{hidden ? "đang ẩn" : `${o.count} ý kiến`}</small>
              </strong>
            </div>
          );
        })}
      </div>
      {hidden && (
        <p className="muted poll-hint">
          Kết quả đang ẩn để học sinh chọn theo ý mình. Bấm "Hiện kết quả" khi muốn cả lớp xem.
        </p>
      )}
    </div>
  );
}
