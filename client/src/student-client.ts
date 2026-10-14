import { useEffect, useRef, useState } from "react";
import type { Data } from "./api";
import { createUuid } from "./uuid";
import { t, translateServer } from "./i18n";

export class StudentApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export async function studentApi(path: string, csrf = "", body?: unknown): Promise<Data> {
  const res = await fetch(`/api/student${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => { throw new StudentApiError(t("Mất kết nối máy chủ. Kiểm tra mạng rồi thử lại."), "NETWORK", 0); });
  const data = await res.json().catch(() => null);
  if (!data) throw new StudentApiError(t("Chưa đọc được phản hồi từ máy chủ. Hãy thử lại sau ít phút."), "NETWORK", 0);
  if (!res.ok) throw new StudentApiError(data.message ? translateServer(data.message) : t("Không thể thực hiện yêu cầu."), data.code, res.status);
  return data;
}
const answerErrors: Record<string, string> = {
  QUESTION_CLOSED: t("Câu đã đóng hoặc hết giờ."), SESSION_PAUSED: t("Bài đang tạm dừng."),
  STALE_SEQUENCE: t("Đã có lựa chọn mới hơn. Đang đồng bộ lại."),
  DEVICE_NOT_ASSIGNED: t("Bạn không còn được ghép vào phòng. Hãy hỏi giáo viên."),
  ANSWER_LOCKED: t("Giáo viên đã khóa lựa chọn đầu tiên."),
  REQUEST_REUSED: t("Không thể gửi lại lựa chọn này. Hãy tải lại trang."),
  INVALID_PAYLOAD: t("Không thể gửi lựa chọn này. Hãy tải lại trang."),
};
export function useStudentQuiz(identity: Data, csrf: string) {
  const [data, setData] = useState<Data | null>(null);
  const [connected, setConnected] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [status, setStatus] = useState(t("Đang kết nối…"));
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const chooseRef = useRef<(choice: string) => void>(() => {});

  useEffect(() => {
    if (!identity.binding_id) return; // /device renders the hook before a room is joined
    let stopped = false, synchronized = false, attempt = 0, seq = 0;
    let state: Data | null = null, pending: Data | null = null, queued: string | null = null;
    let clockOffset = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;
    const storageKey = `student-answer:${identity.binding_id}`;
    setData(null); setConnected(false); setTerminal(false); setNotice(""); setSelected(null);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved?.type === "answer.submit" && saved.binding_id === identity.binding_id &&
        saved.session_id === identity.session_id && Number.isSafeInteger(saved.seq) && saved.seq > 0 &&
        /^[ABCD]$/.test(saved.choice) && typeof saved.request_id === "string") pending = saved;
    } catch { /* An unavailable store still permits this tab to retry in memory. */ }
    setSending(!!pending);
    function clearPending() {
      pending = null; queued = null; clearTimeout(retryTimer); setSending(false);
      try { sessionStorage.removeItem(storageKey); } catch {}
    }
    function transmit() {
      clearTimeout(retryTimer);
      if (stopped || !pending) return;
      if (synchronized && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pending));
      retryTimer = setTimeout(transmit, 1200);
    }
    function mayAnswer() {
      return synchronized && ws?.readyState === WebSocket.OPEN && state?.state === "RUNNING" &&
        state.question?.status === "OPEN" && state.question.deadline_at > Date.now() + clockOffset &&
        (state.allow_change || !state.current_answer);
    }
    function choose(choice: string) {
      if (!mayAnswer() || !/^[ABCD]$/.test(choice)) return;
      setSelected(choice);
      if (pending) { queued = choice; setNotice(t("Chọn {choice} · đang chờ lưu lựa chọn trước…", { choice })); return; }
      pending = { v: 1, type: "answer.submit", request_id: createUuid(),
        session_id: state!.id, question_instance_id: state!.question.id,
        binding_id: state!.binding_id, seq: ++seq, choice };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch {}
      setSending(true); setNotice(t("Đang lưu đáp án {choice}…", { choice })); transmit();
    }
    chooseRef.current = choose;
    function reconnect() {
      if (stopped) return;
      connectTimer = setTimeout(connect, Math.min(10000, 1000 * 2 ** attempt++) + Math.random() * 300);
    }
    async function connect() {
      synchronized = false; setConnected(false); setStatus(t("Đang kết nối máy chủ…"));
      try {
        const { ticket } = await studentApi("/ticket", csrf, {});
        if (stopped) return;
        ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/student`);
        socket.current = ws;
        const active = ws;
        active.onopen = () => active.send(JSON.stringify({ v: 1, type: "hello", ticket }));
        active.onmessage = e => {
          if (stopped || ws !== active) return;
          const msg = JSON.parse(e.data);
          if (msg.type === "session.snapshot") {
            const incoming = msg.data;
            if (incoming.id !== identity.session_id || incoming.binding_id !== identity.binding_id) return;
            if (state && incoming.state_version < state.state_version) return;
            const changedQuestion = state?.question?.id !== incoming.question?.id;
            if (pending && (pending.question_instance_id !== incoming.question?.id || pending.binding_id !== incoming.binding_id))
              clearPending();
            seq = Math.max(changedQuestion ? 0 : seq, incoming.current_answer?.seq || 0, pending?.seq || 0);
            state = incoming; clockOffset = incoming.server_time - Date.now();
            setOffset(clockOffset); setData(incoming);
            synchronized = true; attempt = 0; setConnected(true); setStatus(t("Đã kết nối"));
            if (!pending) {
              setSelected(incoming.current_answer?.choice || null);
              if (changedQuestion) setNotice("");
            }
            if (pending) transmit();
          } else if (msg.type === "answer.ack" && pending?.request_id === msg.request_id) {
            const choice = queued;
            clearPending();
            if (msg.accepted) {
              if (state) state = { ...state, current_answer: { choice: msg.choice, seq: msg.seq } };
              setData(state); setSelected(msg.choice); setNotice(t("Đã lưu đáp án {choice}.", { choice: msg.choice }));
            } else {
              setSelected(state?.current_answer?.choice || null);
              setNotice(answerErrors[msg.code] || t("Chưa lưu được đáp án. Hãy thử lại."));
              active.send(JSON.stringify({ v: 1, type: "snapshot.request" }));
            }
            if (choice && msg.accepted && choice !== msg.choice) choose(choice);
          } else if (msg.type === "error") {
            if (msg.code === "STORAGE_ERROR") {
              setNotice(t("Máy chủ chưa lưu được đáp án. Đang gửi lại…"));
              if (pending) transmit();
            } else if (!synchronized) {
              setStatus(t("Không thể xác thực kết nối. Đang thử lại…")); active.close();
            } else {
              clearPending(); setSelected(state?.current_answer?.choice || null);
              setNotice(answerErrors[msg.code] || t("Không thể lưu đáp án. Hãy thử lại."));
            }
          }
        };
        active.onclose = e => {
          if (stopped || ws !== active) return;
          synchronized = false; setConnected(false);
          if (e.code === 4001 || e.code === 4002) {
            setTerminal(true);
            setStatus(e.code === 4002 ? t("Bài đang được mở ở tab khác. Đóng tab đó rồi kết nối lại.") : t("Bạn không còn trong phòng này hoặc quyền làm bài đã hết. Hãy hỏi giáo viên."));
            return;
          }
          setStatus(t("Mất kết nối · đang nối lại…")); reconnect();
        };
        active.onerror = () => active.close();
      } catch (e) {
        if (stopped) return;
        setStatus((e as Error).message);
        if (e instanceof StudentApiError && (e.status === 401 || e.status === 403)) setTerminal(true);
        else reconnect();
      }
    }
    void connect();
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      synchronized = false; setConnected(false);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, type: "snapshot.request" }));
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true; synchronized = false;
      clearTimeout(retryTimer); clearTimeout(connectTimer);
      document.removeEventListener("visibilitychange", wake);
      ws?.close(); socket.current = null; chooseRef.current = () => {};
    };
  }, [identity.binding_id, identity.session_id, csrf, epoch]);
  return { data, connected, terminal, status, notice, sending, selected, offset,
    choose: (choice: string) => chooseRef.current(choice),
    // Lobby/paused clicker test; the server answers button.ack and records device.test.
    test: (choice: string) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ v: 1, type: "button.test", choice })); },
    reconnect: () => setEpoch(n => n + 1) };
}
