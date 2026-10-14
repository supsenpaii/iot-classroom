import { useCallback, useEffect, useRef, useState } from "react";
import type { Data } from "../api";
import { createUuid } from "../uuid";
import { StudentApiError, studentApi, useStudentQuiz } from "../student-client";
import { ThemeToggle } from "../theme";
import {
  KEYPAD, glyph, idleCtx, joinFailure, joinUncertain, joined, left, newDevice, oledLines, pressKey, tick,
  type Ctx, type Device, type Key,
} from "../../../shared/device-screen";
import "./device.css";
import { t, useLang } from "../i18n";

const OLED_W = 128, OLED_H = 32, ROW_Y = [0, 11, 22];
// Join errors that the server answered definitively (the pending request id is dropped).
const FINAL_JOIN_ERRORS = ["ROOM_UNAVAILABLE", "ROOM_FULL", "STUDENT_UNAVAILABLE", "STUDENT_ALREADY_BOUND",
  "DEVICE_REVOKED", "DEVICE_REMOVED", "DEVICE_BUSY", "DEVICE_OWNER_MISMATCH", "DUPLICATE_LABEL",
  "REQUEST_REUSED", "INVALID_PAYLOAD", "STUDENT_BUSY", "STUDENT_ACCESS_ENDED", "CSRF", "BAD_ORIGIN", "HTTPS_REQUIRED"];

function Oled({ lines, scale }: { lines: string[]; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.fillStyle = "#000"; g.fillRect(0, 0, OLED_W, OLED_H);
    g.fillStyle = "#e8f6ff";
    lines.forEach((line, row) => {
      [...line].forEach((ch, i) => glyph(ch).forEach((bits, col) => {
        for (let y = 0; y < 7; y++) if (bits & (1 << y)) g.fillRect(i * 6 + col, ROW_Y[row] + y, 1, 1);
      }));
    });
  }, [lines.join("\n")]);
  return <canvas ref={ref} className="device-oled" width={OLED_W} height={OLED_H}
    style={{ width: OLED_W * scale, height: OLED_H * scale }} role="img" aria-label={lines.filter(Boolean).join(" / ") || "OLED"} />;
}

export function DevicePage() {
  const [csrf, setCsrf] = useState(""), [identity, setIdentity] = useState<Data | null>(null);
  const [dev, setDev] = useState<Device>(() => newDevice(Date.now()));
  const [now, setNow] = useState(Date.now()), [scale, setScale] = useState(3), [loading, setLoading] = useState(true);
  const quiz = useStudentQuiz(identity ?? {}, csrf);
  const devRef = useRef(dev), packet = useRef<Data | null>(null), joining = useRef(false);
  const s = quiz.data, q = s?.question;
  const paused = s?.state === "PAUSED";
  const remainingSec = q?.status === "OPEN" ? Math.max(0, Math.ceil((paused ? q.remaining_ms : q.deadline_at - now - quiz.offset) / 1000)) : 0;
  const locked = s?.allow_change === false && (!!s.current_answer || quiz.sending);
  const live = !!identity && quiz.connected && !!s;
  const state = identity ? (s?.state ?? "WAITING") : "WAITING";
  const ctx: Ctx = !identity ? idleCtx : {
    joined: true, connected: quiz.connected, snapshotReady: !!s, state,
    questionOpen: q?.status === "OPEN" && remainingSec > 0, hasQuestion: !!q,
    questionOrder: q?.question_order ?? 0, total: s?.total_questions ?? 0, seconds: s?.seconds_per_question ?? 0,
    remainingSec, canAnswer: live && state === "RUNNING" && q?.status === "OPEN" && remainingSec > 0 && !locked,
    resultReady: state === "FINISHED" && !!s?.result,
    result: state === "FINISHED" && s?.result ? { correct: s.result.correct, total: s.result.total,
      score: s.result.score == null ? null : Number(s.result.score) } : null,
    answerText: s && (state === "RUNNING" || state === "PAUSED")
      ? (quiz.sending && quiz.selected ? `SENDING: ${quiz.selected}` : s.current_answer ? `SAVED: ${s.current_answer.choice}` : "") : "",
  };
  const ctxRef = useRef(ctx); ctxRef.current = ctx;
  const update = useCallback((next: Device) => { devRef.current = next; setDev(next); }, []);

  async function bootstrap() {
    try {
      const session = await studentApi("/session");
      setCsrf(session.csrf);
      if (session.pending) {
        packet.current = session.pending;
        update({ ...newDevice(Date.now()), entering: false, room: session.pending.room_code,
          student: session.pending.student_code, pendingJoin: true });
      } else if (session.student) {
        setIdentity(session.student);
        update({ ...newDevice(Date.now()), entering: false, room: session.student.room_code, student: session.student.student_code });
      }
    } catch { /* The OLED keeps showing the entry prompt; ENT retries through studentApi. */ }
    setLoading(false);
  }
  const lang = useLang();
  useEffect(() => { document.title = t("Thiết bị ảo · Lớp học tương tác"); }, [lang]);
  useEffect(() => { void bootstrap(); }, []);
  useEffect(() => {
    const timer = setInterval(() => { const t = Date.now(); setNow(t); update(tick(devRef.current, ctxRef.current, t)); }, 200);
    return () => clearInterval(timer);
  }, [update]);
  useEffect(() => {
    const fit = () => setScale(Math.max(1, Math.floor((Math.min(window.innerWidth - 32, 480) - 62) / OLED_W)));
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => { // Keep the phone awake while a room is open; silently skipped when unsupported.
    if (!identity) return;
    let lock: { release(): Promise<void> } | null = null, closed = false;
    const request = () => (navigator as any).wakeLock?.request("screen").then((l: typeof lock) => {
      if (closed) void l?.release(); else lock = l;
    }).catch(() => {});
    const visible = () => document.visibilityState === "visible" && request();
    request(); document.addEventListener("visibilitychange", visible);
    return () => { closed = true; document.removeEventListener("visibilitychange", visible); void lock?.release(); };
  }, [!!identity]);

  async function join(room: string, student: string) {
    if (joining.current) return;
    joining.current = true;
    packet.current ||= { student_code: student, room_code: room, request_id: createUuid() };
    try {
      const result = await studentApi("/join", csrf, packet.current);
      packet.current = null;
      setIdentity(result.student);
      update(joined(devRef.current, Date.now()));
    } catch (e) {
      const code = e instanceof StudentApiError ? e.code : "";
      if (FINAL_JOIN_ERRORS.includes(code)) {
        packet.current = null;
        update(joinFailure(devRef.current, code, Date.now()));
        if (code === "CSRF") await bootstrap();
      } else update(joinUncertain(devRef.current, Date.now()));
    } finally { joining.current = false; }
  }
  async function leave() {
    try { await studentApi("/leave", csrf, {}); setIdentity(null); update(left(Date.now())); }
    catch { update({ ...devRef.current, notice: "JOIN REJECTED", noticeAt: Date.now() }); }
  }
  const press = useCallback((key: Key) => {
    const t = Date.now();
    const r = pressKey(devRef.current, key, ctxRef.current, t);
    update(r.device);
    navigator.vibrate?.(8);
    const a = r.action;
    if (!a) return;
    if (a.type === "join") void join(a.room, a.student);
    else if (a.type === "choose") quiz.choose(a.choice);
    else if (a.type === "test") quiz.test(a.choice);
    else void leave();
  }, [csrf, quiz.choose, quiz.test]);
  const pressRef = useRef(press); pressRef.current = press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const key: Key | null = /^[0-9A-D]$/.test(k) ? k as Key : k === "Enter" ? "ENT" : k === "Backspace" ? "DEL" : null;
      if (!key) return;
      e.preventDefault(); pressRef.current(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lines = oledLines(dev, ctx, now);
  return <main className="student-page device-page">
    <div className="student-topbar"><a className="student-brand" href="/device"><span>{t("Thiết bị ảo")}</span></a><ThemeToggle /></div>
    <section className="device-body" aria-label={t("Thiết bị ESP32 ảo")}>
      <div className="device-head"><span className={`device-led ${!dev.sleeping && !loading ? "is-on" : ""}`} aria-hidden="true" /><span>ESP32 · CLICKER</span></div>
      <div className="device-screen"><Oled lines={lines} scale={scale} /></div>
      <div className="device-keypad" role="group" aria-label={t("Bàn phím")}>
        {KEYPAD.flat().map(key => <button key={key} type="button" data-key={key}
          className={`device-key ${/^[A-D]$/.test(key) ? "is-letter" : key === "DEL" ? "is-del" : key === "ENT" ? "is-ent" : ""}`}
          onClick={() => press(key)}>{key}</button>)}
      </div>
    </section>
    <p className="student-help device-help">{t("Nhập ROOM ID 8 số rồi ENT, sau đó nhập MSSV rồi ENT. Có thể dùng bàn phím máy tính: 0–9, A–D, Enter, Backspace.")}</p>
    {identity && <p className="student-help device-help"><a href="/student">{t("Mở giao diện làm bài đầy đủ")}</a></p>}
  </main>;
}
