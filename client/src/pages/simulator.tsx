import { createUuid } from "../uuid";
import { useEffect, useRef, useState } from "react";
import { api, stateLabel, errorLabel, type Data } from "../api";
import { Head, Status, useApp, useResource } from "../components";
import { socketUrl } from "../socket";
import type { FlashcardRatePacket } from "../../../shared/protocol";
import { t, lazy, tk } from "../i18n";
const ratingLabel: Record<string, string> = lazy(() => ({ KNOWN: t("Nhớ"), AGAIN: t("Chưa nhớ") }));
function SimDevice({ device }: { device: Data }) {
  const [state, setState] = useState<Data>({ state: "WAITING" }),
    [status, setStatus] = useState(tk("Đang kết nối…")),
    [ack, setAck] = useState(t("Chưa gửi")),
    [offline, setOffline] = useState(false);
  const socket = useRef<WebSocket | null>(null),
    current = useRef<Data>({}),
    pending = useRef<Data | null>(null),
    queued = useRef<string | null>(null),
    queuedRating = useRef<FlashcardRatePacket | null>(null),
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
  function send(packet: Data, label: string) {
    pending.current = packet;
    last.current = packet;
    setAck(t("Đang gửi {label}…", { label }));
    transmit();
  }
  function sameDisplay(packet: FlashcardRatePacket, s: Data) {
    return s.mode === "flashcard" && s.state === "RUNNING" &&
      packet.review_id === s.id && packet.card_id === s.card?.id &&
      packet.round === s.round && packet.display_id === s.display_id;
  }
  function choose(choice: string) {
    const s = current.current;
    if ((s.mode === "poll" || s.mode === "attendance") && pending.current) {
      queued.current = choice;
      setAck(t("Đang chờ ACK · giữ lựa chọn mới nhất"));
      return;
    }
    if (s.mode === "attendance") {
      send(
        { v: 1, type: "attendance.checkin", request_id: createUuid(), attendance_id: s.id },
        t("điểm danh"),
      );
      return;
    }
    if (s.mode === "poll") {
      if ("ABCD".indexOf(choice) >= s.options) {
        setAck(t("Khảo sát chỉ có {options} lựa chọn", { options: s.options }));
        return;
      }
      send(
        { v: 1, type: "poll.vote", request_id: createUuid(), poll_id: s.id, choice },
        t("ý kiến {choice}", { choice }),
      );
      return;
    }
    if (s.mode === "flashcard") {
      // A = remembered, B = not yet.
      const rating = choice === "A" ? "KNOWN" : choice === "B" ? "AGAIN" : null;
      if (!rating) {
        setAck(t("Flashcard: A = Nhớ, B = Chưa nhớ"));
        return;
      }
      if (!s.display_id || !Number.isInteger(s.round)) {
        setAck(t("Chưa đồng bộ lượt ôn tập. Đang lấy lại trạng thái…"));
        socket.current?.send(JSON.stringify({ v: 1, type: "snapshot.request" }));
        return;
      }
      const packet: FlashcardRatePacket = {
        v: 1,
        type: "flashcard.rate",
        request_id: createUuid(),
        review_id: s.id,
        card_id: s.card.id,
        round: s.round,
        display_id: s.display_id,
        rating,
      };
      if (pending.current) {
        if (pending.current.type === "flashcard.rate") {
          queuedRating.current = packet;
          setAck(t("Đang chờ ACK · giữ lựa chọn mới nhất"));
        } else setAck(t("Đang chờ ACK của hoạt động trước"));
        return;
      }
      send(packet, ratingLabel[rating]);
      return;
    }
    if (s.state === "LOBBY" || s.state === "PAUSED") {
      socket.current?.send(
        JSON.stringify({ v: 1, type: "button.test", choice }),
      );
      return;
    }
    if (!s.binding_id) {
      setAck(t("Chưa ghép học sinh"));
      return;
    }
    if (s.state !== "RUNNING" || s.question?.status !== "OPEN") {
      setAck(t("Câu chưa mở hoặc đã đóng"));
      return;
    }
    if (pending.current) {
      queued.current = choice;
      setAck(t("Đang chờ ACK · giữ lựa chọn mới nhất"));
      return;
    }
    const packet = {
      v: 1,
      type: "answer.submit",
      session_id: s.id,
      question_instance_id: s.question.id,
      binding_id: s.binding_id,
      request_id: createUuid(),
      seq: ++seq.current,
      choice,
    };
    pending.current = packet;
    last.current = packet;
    setAck(t("Đang gửi {choice}…", { choice }));
    transmit();
  }
  useEffect(() => {
    if (offline) {
      setStatus(tk("Mất mạng mô phỏng"));
      return;
    }
    let stopped = false,
      attempt = 0,
      timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        setStatus(attempt ? tk("Đang nối lại…") : tk("Đang kết nối…"));
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
            setStatus(tk("Đã kết nối"));
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
            if (queuedRating.current && !sameDisplay(queuedRating.current, msg.data))
              queuedRating.current = null;
            if (pending.current) transmit();
          } else if (msg.type === "flashcard.ack") {
            if (pending.current && pending.current.request_id !== msg.request_id) return;
            if (drop.current) {
              drop.current = false;
              setAck(t("Đã bỏ ACK để thử gửi lại…"));
              return;
            }
            setAck(msg.accepted
              ? t("Đã ACK {v}{v2}", { v: ratingLabel[msg.rating], v2: msg.duplicate ? t(" · gói gửi lại") : "" })
              : t("Từ chối: {v}", { v: errorLabel[msg.code] || msg.code }));
            if (pending.current?.request_id === msg.request_id) {
              pending.current = null;
              if (retryTimer.current) clearTimeout(retryTimer.current);
              const next = queuedRating.current;
              queuedRating.current = null;
              const choice = queued.current;
              queued.current = null;
              if (next && sameDisplay(next, current.current))
                send(next, ratingLabel[next.rating]);
              else if (choice && current.current.mode !== "flashcard") choose(choice);
            }
          } else if (["poll.ack", "attendance.ack"].includes(msg.type)) {
            setAck(
              msg.accepted
                ? msg.type === "attendance.ack"
                  ? t("Đã điểm danh")
                  : t("Đã ACK {v}", { v: msg.type === "poll.ack" ? t("ý kiến {choice}", { choice: msg.choice }) : ratingLabel[msg.rating] })
                : t("Từ chối: {v}", { v: errorLabel[msg.code] || msg.code }),
            );
            if (pending.current?.request_id === msg.request_id) {
              pending.current = null;
              if (retryTimer.current) clearTimeout(retryTimer.current);
              const choice = queued.current;
              queued.current = null;
              if (choice) choose(choice);
            }
          } else if (msg.type === "answer.ack") {
            if (drop.current) {
              drop.current = false;
              setAck(t("Đã bỏ ACK để thử gửi lại…"));
              return;
            }
            setAck(
              msg.accepted
                ? t("Đã ACK {choice} · seq {seq}{v}", { choice: msg.choice, seq: msg.seq, v: msg.duplicate ? t(" · gói gửi lại") : "" })
                : t("Từ chối: {v}", { v: errorLabel[msg.code] || msg.code }),
            );
            if (pending.current?.request_id === msg.request_id) {
              pending.current = null;
              if (retryTimer.current) clearTimeout(retryTimer.current);
              const choice = queued.current;
              queued.current = null;
              if (choice) choose(choice);
            }
          } else if (msg.type === "button.ack")
            setAck(msg.assigned ? t("Đã nhận bấm thử") : t("Bấm thử: chưa ghép"));
          else if (msg.type === "error")
            setAck(t("Lỗi: {v}", { v: errorLabel[msg.code] || msg.code }));
        };
        ws.onclose = (e) => {
          if (stopped) return;
          if (e.code === 4001 || e.code === 4002) {
            setStatus(tk("Kết nối bị thu hồi hoặc thay thế"));
            return;
          }
          setStatus(tk("Mất kết nối"));
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
        <span className="badge">{t(status)}</span>
      </div>
      {state.mode === "poll" ? (
        <p>
          
          {t("Khảo sát ·")} {state.options}  {t("lựa chọn")}
          {state.current_choice && t(" · đã chọn {current_choice}", { current_choice: state.current_choice })}
        </p>
      ) : state.mode === "attendance" ? (
        <p>
          
          {t("Điểm danh ·")} {state.checked_in ? t("đã có mặt") : t("bấm phím bất kỳ để điểm danh")}
        </p>
      ) : state.mode === "flashcard" ? (
        <p>
          
          {t("Flashcard · thẻ")} {state.card.index}/{state.card.total} ·{" "}
          {state.card.side === "back" ? t("mặt sau") : t("mặt trước")}  {t("· A = Nhớ, B = Chưa nhớ")}
          {state.current_rating &&
            t(" · đã chọn {v}", { v: ratingLabel[state.current_rating] })}
        </p>
      ) : (
        <p>
          {state.binding_id ? t("Đã ghép học sinh") : t("Chờ giáo viên ghép thiết bị")}{" "}
          ·{" "}
          {state.question
            ? `${stateLabel[state.question.status]}`
            : t("Chưa mở câu")}
        </p>
      )}
      <div className="sim-buttons">
        {["A", "B", "C", "D"].map((c) => (
          <button
            key={c}
            className={`choice-${c.toLowerCase()}`}
            disabled={offline || status !== tk("Đã kết nối")}
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
          {offline ? t("Nối lại mạng") : t("Ngắt mạng")}
        </button>
        <button
          onClick={() => {
            drop.current = true;
            setAck(t("Sẽ bỏ ACK kế tiếp rồi tự gửi lại"));
          }}
        >
          
          {t("Mất ACK một lần")}
        </button>
        <button
          disabled={!last.current || offline}
          onClick={() => {
            if (socket.current?.readyState === WebSocket.OPEN)
              socket.current.send(JSON.stringify(last.current));
          }}
        >
          
          {t("Gửi lại gói cuối")}
        </button>
      </div>
    </article>
  );
}
export function Simulator() {
  const { user, run } = useApp(),
    r = useResource<Data[]>("/devices"),
    [enabled, setEnabled] = useState<string[]>([]),
    [count, setCount] = useState(1),
    [roomCode, setRoomCode] = useState(""),
    [joining, setJoining] = useState(false);
  const joinBatch = useRef<{ code: string; packets: Data[] } | null>(null);
  if (!user.simulator)
    return <Status error={t("Giả lập đã tắt trên môi trường này.")} />;
  return (
    <>
      <Head
        eyebrow={t("MÔI TRƯỜNG THỬ")}
        title={t("Thiết bị giả. Luồng kiểm tra thật.")}
        description={t("Cùng giao thức WebSocket và quy tắc ACK như ESP32. Mỗi thẻ là một thiết bị.")}
      />
      <section className="card room-pairing">
        <h2>{t("Tự kết nối bằng ROOM ID")}</h2>
        <p className="muted">{t("Mở nhận thiết bị ở phòng kiểm tra, nhập mã rồi kết nối. Thiết bị giả lập vào phòng chưa ghép; giáo viên chọn MSSV cho từng thiết bị trong Quản lý thiết bị & sửa ghép học sinh trước khi bắt đầu.")}</p>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          if (joining) return;
          setJoining(true);
          void run(async () => {
            const code = roomCode.replace(/\s/g, "");
            if (!/^\d{8}$/.test(code)) throw Error(t("ROOM ID cần đúng 8 chữ số."));
            if (!Number.isInteger(count) || count < 1 || count > 50) throw Error(t("Chọn từ 1 đến 50 thiết bị."));
            // Keep the exact packets in memory until the batch succeeds so a lost response is retryable.
            if (!joinBatch.current || joinBatch.current.code !== code)
              joinBatch.current = { code, packets: Array.from({ length: count }, (_, i) => ({
                v: 1, room_code: code, request_id: createUuid(),
                device_name: `SIM-ROOM-${String(i + 1).padStart(2, "0")}`,
                device_secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join(""),
              })) };
            try {
              for (const packet of joinBatch.current.packets) {
                const result = await api("/simulator/pairing/join", "POST", packet);
                setEnabled((ids) => ids.includes(result.device_id) ? ids : [...ids, result.device_id]);
              }
              joinBatch.current = null;
            } finally { r.reload(); }
          }, t("Thiết bị đã vào phòng và chờ ghép. Mở Quản lý thiết bị trong phòng, chọn MSSV cho từng thiết bị rồi bấm thử.")).finally(() => setJoining(false));
        }}>
          <label className="field">ROOM ID<input inputMode="numeric" autoComplete="off" required value={roomCode} placeholder="4827 1936" maxLength={12} disabled={joining} onChange={(e) => { setRoomCode(e.target.value); joinBatch.current = null; }} /></label>
          <label className="field">{t("Số thiết bị")}<input type="number" min={1} max={50} required value={count} disabled={joining} onChange={(e) => { setCount(Number(e.target.value)); joinBatch.current = null; }} /></label>
          <button className="primary" disabled={joining}>{joining ? t("Đang kết nối…") : t("Kết nối bằng mã")}</button>
        </form>
      </section>
      <div className="card">
        <div className="row spread">
          <div>
            <h2>{t("Kết nối thiết bị đã đăng ký")}</h2>
            <p className="muted">
              
              {t("Mở trang này bên cạnh phòng chờ, ghép thiết bị rồi bấm A/B/C/D để thử.")}
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
            
            {t("Kết nối tối đa 50 thiết bị")}
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
            }, t("Đã tạo thiết bị thử. Chọn kết nối và ghép trong phòng chờ."));
          }}
        >
          <label className="field">
            
            {t("Số thiết bị thử cần tạo")}
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <button>{t("Tạo thiết bị giả lập")}</button>
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
