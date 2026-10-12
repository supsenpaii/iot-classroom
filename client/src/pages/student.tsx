import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Data } from "../api";
import { createUuid } from "../uuid";
import { StudentApiError, studentApi, useStudentQuiz } from "../student-client";
import { ThemeToggle } from "../theme";
import "./student.css";

function QuizRoom({ identity, csrf, onLeave }: { identity: Data; csrf: string; onLeave: () => Promise<void> }) {
  const quiz = useStudentQuiz(identity, csrf);
  const [now, setNow] = useState(Date.now());
  const [leaving, setLeaving] = useState(false), [error, setError] = useState("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer); }, []);
  const s = quiz.data, q = s?.question;
  const ended = s?.state === "FINISHED" || s?.state === "CANCELLED";
  const paused = s?.state === "PAUSED";
  const remaining = q?.status === "OPEN" ? Math.max(0, Math.ceil((paused ? q.remaining_ms : q.deadline_at - now - quiz.offset) / 1000)) : 0;
  const locked = s?.allow_change === false && (!!s.current_answer || quiz.sending);
  const mayAnswer = quiz.connected && s?.state === "RUNNING" && q?.status === "OPEN" && remaining > 0 && !locked;
  async function leave() {
    setLeaving(true); setError("");
    try { await onLeave(); } catch (e) { setError((e as Error).message); } finally { setLeaving(false); }
  }
  return <div className="student-room">
    <header className="student-room-head">
      <div><p className="student-eyebrow">{s?.class_name || "PHÒNG KIỂM TRA"}</p><h1>{s?.name || "Đang vào phòng…"}</h1></div>
      <div className="student-identity"><strong>{s?.full_name || `MSSV ${identity.student_code}`}</strong><span>MSSV {identity.student_code}</span></div>
    </header>
    <p role="status" className={`student-connection ${quiz.connected ? "is-connected" : ""}`}>{quiz.status}</p>
    {!quiz.connected && quiz.terminal && <div className="student-reconnect"><button onClick={quiz.reconnect}>Kết nối lại</button><button disabled={leaving} onClick={() => void leave()}>Quay lại nhập phòng</button></div>}
    {error && <p role="alert" className="student-error">{error}</p>}
    {s && ended ? <section className="student-panel student-result">
      <p className="student-eyebrow">{s.state === "CANCELLED" ? "BUỔI KIỂM TRA ĐÃ HỦY" : "ĐÃ HOÀN THÀNH"}</p>
      <h2>{s.state === "CANCELLED" ? "Giáo viên đã hủy buổi kiểm tra." : "Kết quả của bạn"}</h2>
      {s.result && <><p className="student-score">{s.result.score == null ? "—" : Number(s.result.score).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}<span>/ 10</span></p><p>Đúng <strong>{s.result.correct}/{s.result.total}</strong> câu được tính điểm.</p></>}
      {!s.result && s.state === "FINISHED" && <p>Buổi kiểm tra đã kết thúc. Hỏi giáo viên để xem kết quả.</p>}
      <button className="primary" disabled={leaving} onClick={() => void leave()}>{leaving ? "Đang chuyển…" : "Vào phòng khác"}</button>
    </section> : s?.state === "LOBBY" ? <section className="student-panel student-waiting">
      <span className="student-waiting-symbol" aria-hidden="true">✓</span><h2>Bạn đã vào phòng</h2>
      <p>Chờ giáo viên bắt đầu bài kiểm tra.</p>
      <div className="student-facts"><span><strong>{s.total_questions}</strong> câu hỏi</span><span><strong>{s.seconds_per_question}</strong> giây / câu</span></div>
    </section> : s && q ? <section className="student-panel student-question">
      <div className="student-question-head"><p>Câu <strong>{q.question_order}</strong> / {s.total_questions}</p><div className={`student-timer ${remaining <= 5 && !paused ? "is-urgent" : ""}`} role="timer" aria-label={`Còn ${remaining} giây`}><strong>{remaining}</strong><span>giây{paused ? " · tạm dừng" : ""}</span></div></div>
      <h2>{q.question}</h2>
      {paused && <p className="student-banner">Giáo viên đang tạm dừng. Bạn sẽ tiếp tục khi bài được mở lại.</p>}
      {!paused && (q.status !== "OPEN" || remaining === 0) && <p className="student-banner">Đã hết thời gian trả lời. Chờ câu tiếp theo.</p>}
      <div className="student-answers" role="group" aria-label="Chọn đáp án">
        {["A", "B", "C", "D"].map(choice => <button key={choice} type="button"
          className={`student-answer ${quiz.selected === choice ? "is-selected" : ""}`}
          aria-pressed={quiz.selected === choice} disabled={!mayAnswer} onClick={() => quiz.choose(choice)}>
          <span className="student-answer-letter">{choice}</span><span>{q[`option_${choice.toLowerCase()}`]}</span>
        </button>)}
      </div>
      <div role="status" className="student-answer-status">{quiz.notice || (s.current_answer ? `Đã lưu đáp án ${s.current_answer.choice}.` : "Chọn một đáp án để gửi.")}</div>
      {s.allow_change === false ? <p className="student-help">Mỗi câu chỉ được chọn một lần.</p> : <p className="student-help">Bạn có thể đổi đáp án khi câu hỏi còn thời gian.</p>}
    </section> : <section className="student-panel student-waiting"><h2>{paused ? "Bài đang tạm dừng" : "Đang đồng bộ bài kiểm tra…"}</h2><p>Giữ trang này mở để nhận câu hỏi từ giáo viên.</p></section>}
  </div>;
}

export function StudentPage() {
  const [csrf, setCsrf] = useState("");
  const [identity, setIdentity] = useState<Data | null>(null);
  const [studentCode, setStudentCode] = useState(""), [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  const packet = useRef<Data | null>(null);
  async function bootstrap() {
    setLoading(true); setError("");
    try {
      const session = await studentApi("/session");
      setCsrf(session.csrf); setIdentity(session.pending ? null : session.student);
      packet.current = session.pending;
      setUncertain(!!session.pending);
      if (session.pending) { setStudentCode(session.pending.student_code); setRoomCode(session.pending.room_code); }
      if (session.access_ended) setError("Bạn đã được gỡ khỏi phòng hoặc quyền làm bài đã hết. Hỏi giáo viên rồi nhập lại phòng.");
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { document.title = "Làm bài kiểm tra · Lớp học tương tác"; void bootstrap(); }, []);
  async function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy || !csrf) return;
    const code = studentCode.trim(), room = roomCode.replace(/\s/g, "");
    if (!/^\d{1,10}$/.test(code)) { setError("MSSV cần từ 1 đến 10 chữ số."); return; }
    if (!/^\d{8}$/.test(room)) { setError("Room ID cần đúng 8 chữ số."); return; }
    packet.current ||= { student_code: code, room_code: room, request_id: createUuid() };
    setBusy(true); setError("");
    try {
      const result = await studentApi("/join", csrf, packet.current);
      setIdentity(result.student); packet.current = null; setUncertain(false);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof StudentApiError && ["ROOM_UNAVAILABLE", "ROOM_FULL", "STUDENT_UNAVAILABLE",
        "STUDENT_ALREADY_BOUND", "DEVICE_REVOKED", "DEVICE_REMOVED", "DEVICE_BUSY",
        "DEVICE_OWNER_MISMATCH", "DUPLICATE_LABEL", "REQUEST_REUSED", "INVALID_PAYLOAD",
        "STUDENT_BUSY", "CSRF", "BAD_ORIGIN", "HTTPS_REQUIRED"].includes(e.code)) {
        packet.current = null; setUncertain(false);
        if (e.code === "CSRF") await bootstrap();
      } else setUncertain(true);
    } finally { setBusy(false); }
  }
  return <main className="student-page">
    <div className="student-topbar"><a className="student-brand" href="/student">Lớp học <span>tương tác</span></a><ThemeToggle /></div>
    {identity ? <QuizRoom identity={identity} csrf={csrf} onLeave={async () => {
      await studentApi("/leave", csrf, {}); setIdentity(null); setRoomCode(""); setError("");
    }} /> : <section className="student-entry student-panel">
      <p className="student-eyebrow">DÀNH CHO HỌC SINH</p><h1>Vào phòng kiểm tra</h1>
      <p className="student-entry-help">Nhập MSSV và mã phòng giáo viên cung cấp.</p>
      <form onSubmit={join}>
        <label className="student-field">MSSV<input name="student_code" inputMode="numeric" pattern="[0-9]{1,10}" maxLength={10} required autoComplete="off" placeholder="Ví dụ: 00123456" value={studentCode} disabled={loading || busy || uncertain} onChange={e => setStudentCode(e.target.value.replace(/\D/g, ""))} /></label>
        <label className="student-field">Room ID<input name="room_code" inputMode="numeric" pattern="[0-9 ]{8,12}" maxLength={12} required autoComplete="off" placeholder="8 chữ số" value={roomCode} disabled={loading || busy || uncertain} onChange={e => setRoomCode(e.target.value.replace(/[^\d ]/g, ""))} /></label>
        {error && <p role="alert" className="student-error">{error}</p>}
        {uncertain && <p className="student-help">Chưa xác định được kết quả vào phòng. Nhấn gửi lại để tiếp tục đúng yêu cầu trước.</p>}
        <button className="primary" disabled={loading || busy || !csrf}>{loading ? "Đang kết nối…" : busy ? "Đang vào phòng…" : uncertain ? "Gửi lại yêu cầu" : "Vào phòng"}</button>
        {!loading && !csrf && <button type="button" onClick={() => void bootstrap()}>Thử kết nối lại</button>}
      </form>
      <p className="student-help">Không cần tài khoản. MSSV phải có trong danh sách kiểm tra và phòng đang mở nhận.</p>
      <a className="student-teacher-link" href="/login">Đăng nhập dành cho giáo viên</a>
    </section>}
  </main>;
}
