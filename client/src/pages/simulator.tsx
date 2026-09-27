import { useEffect, useRef, useState } from "react";
import { api, stateLabel, errorLabel, type Data } from "../api";
import { Head, Status, useApp, useResource } from "../components";
import { socketUrl } from "../socket";
function SimDevice({ device }: { device: Data }) {
  const [state, setState] = useState<Data>({ state: "WAITING" }),
    [status, setStatus] = useState("Đang kết nối…"),
    [ack, setAck] = useState("Chưa gửi"),
    [offline, setOffline] = useState(false);
  const socket = useRef<WebSocket | null>(null),
    current = useRef<Data>({}),
    pending = useRef<Data | null>(null),
    queued = useRef<string | null>(null),
    last = useRef<Data | null>(null),
    seq = useRef(0),
    drop = useRef(false),
    retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function transmit() {
    if (pending.current && socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(pending.current));
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (pending.current) retryTimer.current = setTimeout(transmit, 1200);
  }
  function choose(choice: string) {
    const s = current.current;
    if (!s.binding_id) {
      setAck("Chưa ghép học sinh");
      return;
    }
    if (s.state === "LOBBY" || s.state === "PAUSED") {
      socket.current?.send(
        JSON.stringify({ v: 1, type: "button.test", choice }),
      );
      return;
    }
    if (s.state !== "RUNNING" || s.question?.status !== "OPEN") {
      setAck("Câu chưa mở hoặc đã đóng");
      return;
    }
    if (pending.current) {
      queued.current = choice;
      setAck("Đang chờ ACK · giữ lựa chọn mới nhất");
      return;
    }
    const packet = {
      v: 1,
      type: "answer.submit",
      session_id: s.id,
      question_instance_id: s.question.id,
      binding_id: s.binding_id,
      request_id: crypto.randomUUID(),
      seq: ++seq.current,
      choice,
    };
    pending.current = packet;
    last.current = packet;
    setAck(`Đang gửi ${choice}…`);
    transmit();
  }
  useEffect(() => {
    if (offline) {
      setStatus("Mất mạng mô phỏng");
      return;
    }
    let stopped = false,
      attempt = 0,
      timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        setStatus(attempt ? "Đang nối lại…" : "Đang kết nối…");
        const { ticket } = await api(`/devices/${device.id}/ticket`, "POST");
        if (stopped) return;
        const ws = new WebSocket(socketUrl());
        socket.current = ws;
        ws.onopen = () => {
          attempt = 0;
          ws.send(JSON.stringify({ v: 1, type: "hello", ticket }));
        };
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === "session.snapshot") {
            const old = current.current;
            current.current = msg.data;
            setState(msg.data);
            setStatus("Đã kết nối");
            if (
              old.question?.id !== msg.data.question?.id ||
              old.binding_id !== msg.data.binding_id
            )
              seq.current = msg.data.current_answer?.seq || 0;
            else
              seq.current = Math.max(
                seq.current,
                msg.data.current_answer?.seq || 0,
              );
            if (pending.current) transmit();
          } else if (msg.type === "answer.ack") {
            if (drop.current) {
              drop.current = false;
              setAck("Đã bỏ ACK để thử gửi lại…");
              return;
            }
            setAck(
              msg.accepted
                ? `Đã ACK ${msg.choice} · seq ${msg.seq}${msg.duplicate ? " · gói gửi lại" : ""}`
                : `Từ chối: ${errorLabel[msg.code] || msg.code}`,
            );
            if (pending.current?.request_id === msg.request_id) {
              pending.current = null;
              if (retryTimer.current) clearTimeout(retryTimer.current);
              const choice = queued.current;
              queued.current = null;
              if (choice) choose(choice);
            }
          } else if (msg.type === "button.ack")
            setAck(msg.assigned ? "Đã nhận bấm thử" : "Bấm thử: chưa ghép");
          else if (msg.type === "error")
            setAck(`Lỗi: ${errorLabel[msg.code] || msg.code}`);
        };
        ws.onclose = (e) => {
          if (stopped) return;
          if (e.code === 4001 || e.code === 4002) {
            setStatus("Kết nối bị thu hồi hoặc thay thế");
            return;
          }
          setStatus("Mất kết nối");
          timer = setTimeout(
            connect,
            Math.min(10000, 1000 * 2 ** attempt++) + Math.random() * 300,
          );
        };
        ws.onerror = () => ws.close();
      } catch (e) {
        setStatus((e as Error).message);
        if (!stopped)
          timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** attempt++));
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      socket.current?.close();
    };
  }, [device.id, offline]);
  return (
    <article className="card simulator-device">
      <div className="row spread">
        <h2>{device.label}</h2>
        <span className="badge">{status}</span>
      </div>
      <p>
        {state.binding_id ? "Đã ghép học sinh" : "Chờ giáo viên ghép thiết bị"}{" "}
        ·{" "}
        {state.question
          ? `${stateLabel[state.question.status]}`
          : "Chưa mở câu"}
      </p>
      <div className="sim-buttons">
        {["A", "B", "C", "D"].map((c) => (
          <button
            key={c}
            disabled={offline || status !== "Đã kết nối"}
            onClick={() => choose(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <p role="status" className="ack">
        {ack}
      </p>
      <div className="actions">
        <button onClick={() => setOffline(!offline)}>
          {offline ? "Nối lại mạng" : "Ngắt mạng"}
        </button>
        <button
          onClick={() => {
            drop.current = true;
            setAck("Sẽ bỏ ACK kế tiếp rồi tự gửi lại");
          }}
        >
          Mất ACK một lần
        </button>
        <button
          disabled={!last.current || offline}
          onClick={() => {
            if (socket.current?.readyState === WebSocket.OPEN)
              socket.current.send(JSON.stringify(last.current));
          }}
        >
          Gửi lại gói cuối
        </button>
      </div>
    </article>
  );
}
export function Simulator() {
  const { user, run } = useApp(),
    r = useResource<Data[]>("/devices"),
    [enabled, setEnabled] = useState<string[]>([]),
    [count, setCount] = useState(1);
  if (!user.simulator)
    return <Status error="Giả lập đã tắt trên môi trường này." />;
  return (
    <>
      <Head
        eyebrow="MÔI TRƯỜNG THỬ"
        title="Thiết bị giả. Luồng kiểm tra thật."
        description="Cùng giao thức WebSocket và quy tắc ACK như ESP32. Mỗi thẻ là một thiết bị."
      />
      <div className="card">
        <div className="row spread">
          <div>
            <h2>Kết nối thiết bị đã đăng ký</h2>
            <p className="muted">
              Mở trang này bên cạnh phòng chờ, ghép thiết bị rồi bấm A/B/C/D để
              thử.
            </p>
          </div>
          <button
            className="primary"
            onClick={() =>
              setEnabled(
                r.data
                  ?.filter((d) => !d.revoked)
                  .slice(0, 50)
                  .map((d) => d.id) || [],
              )
            }
          >
            Kết nối tối đa 50 thiết bị
          </button>
        </div>
        <div className="device-choices">
          {r.data
            ?.filter((d) => !d.revoked)
            .map((d) => (
              <label className="check" key={d.id}>
                <input
                  type="checkbox"
                  checked={enabled.includes(d.id)}
                  onChange={(e) =>
                    setEnabled((ids) =>
                      e.target.checked
                        ? [...ids, d.id]
                        : ids.filter((id) => id !== d.id),
                    )
                  }
                />
                {d.label}
              </label>
            ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              for (let i = 0; i < count; i++)
                await api("/devices", "POST", {
                  label: `SIM-${String((r.data?.length || 0) + i + 1).padStart(2, "0")}`,
                });
              r.reload();
            }, "Đã tạo thiết bị thử. Chọn kết nối và ghép trong phòng chờ.");
          }}
        >
          <label className="field">
            Số thiết bị thử cần tạo
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button>Tạo thiết bị giả lập</button>
        </form>
      </div>
      <Status error={r.error} loading={!r.data} />
      <div className="sim-grid">
        {r.data
          ?.filter((d) => enabled.includes(d.id))
          .map((d) => (
            <SimDevice key={d.id} device={d} />
          ))}
      </div>
    </>
  );
}
