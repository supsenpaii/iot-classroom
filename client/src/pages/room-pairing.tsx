import { createUuid } from "../uuid";
import { copyText } from "../clipboard";
import { useEffect, useState } from "react";
import { api, type Data } from "../api";
import { useApp } from "../components";
import { t, locale } from "../i18n";

export function RoomPairing({ session: s, offset, connected, reload }: { session: Data; offset: number; connected: boolean; reload: () => void }) {
  const { run, user } = useApp();
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false);
  const p = s.pairing;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil(((p?.expires_at ?? 0) - now - offset) / 1000));
  const open = p?.status === "OPEN" && remaining > 0;
  const editable = ["LOBBY", "PAUSED"].includes(s.state);
  const devices: Data[] = s.room_devices ?? [];
  const students: Data[] = s.students.filter((st: Data) => !st.absent);
  const online = students.filter(st => st.online);
  const unassigned = devices.filter(d => !d.revoked && !d.session_student_id);
  const execute = (task: () => Promise<void>, message?: string) => {
    if (busy) return;
    setBusy(true);
    void run(async () => { await task(); reload(); }, message).finally(() => setBusy(false));
  };
  const command = (action: string) => execute(async () => {
    await api(`/sessions/${s.id}/pairing/${action}`, "POST", {
      command_id: createUuid(), expected_version: s.state_version,
    });
  }, action === "open" ? t("Đã mở nhận thiết bị trong 5 phút.") : t("Đã đóng nhận thiết bị mới."));
  return <section className="card room-pairing" aria-label={t("Kết nối bằng ROOM ID")}>
    <div className="row spread">
      <div><h2>{t("Kết nối lớp học bằng ROOM ID")}</h2><p className="muted">{t("Mở nhận, học sinh nhập MSSV và mã phòng trên ESP32 hoặc trang làm bài.")}</p></div>
      {user.simulator && <a className="button" href="/simulator" target="_blank" rel="noreferrer">{t("Mở giả lập ↗")}</a>}
    </div>
    <div className="student-share"><p><strong>{t("Làm bài trên điện thoại hoặc máy tính")}</strong></p><a href="/student" target="_blank" rel="noreferrer">{window.location.origin}/student</a> · <a href="/device" target="_blank" rel="noreferrer">{t("Thiết bị ảo")}</a><p className="muted">{t("Gửi đường dẫn này cho học sinh cùng Room ID. Học sinh nhập đúng MSSV để được ghép vào bài kiểm tra.")}</p></div>
    <div className="pairing-layout">
      <div className="pairing-entry">
        <span className="badge">{open ? t("Đang nhận thiết bị") : p?.status === "EXPIRED" || (p?.status === "OPEN" && !remaining) ? t("Mã hết hạn") : t("Chưa mở nhận thiết bị")}</span>
        {open ? <div role="status"><strong className="pairing-code">{p.room_code.slice(0, 4)} {p.room_code.slice(4)}</strong><p>{t("Còn")} {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}  {t("· Mã dùng chung cho cả lớp")}</p></div> : <p>{editable ? t("Nhấn Mở nhận thiết bị để tạo mã 8 chữ số.") : t("Bài đang chạy. Tạm dừng để nhận thêm thiết bị.")}</p>}
        <p className="muted pairing-help">{t("Thiết bị gửi MSSV được ghép đúng học sinh trong phòng. Thiết bị không gửi MSSV chờ giáo viên chọn học sinh trong quản lý thiết bị; không ghép theo thứ tự kết nối.")}</p>
        <div className="actions">
          {editable && !open && <button className="primary" disabled={busy || !connected} onClick={() => command("open")}>{t("Mở nhận thiết bị")}</button>}
          {open && <button className="primary" onClick={() => void run(() => copyText(p.room_code), t("Đã sao chép ROOM ID."))}>{t("Sao chép mã")}</button>}
          {editable && open && <button disabled={busy || !connected} onClick={() => command("close")}>{t("Đóng nhận")}</button>}
        </div>
        {editable && open && <button className="text-button" disabled={busy || !connected} onClick={() => command("open")}>{t("Tạo mã mới")}</button>}
        <small className="muted">{t("Đóng nhận không ngắt thiết bị đã kết nối.")}</small>
      </div>
      <div className="pairing-roster">
        <div className="row spread"><h3>{t("Học sinh đã kết nối")}</h3><strong aria-live="polite">{online.length}/{students.length}</strong></div>
        <p className="muted">{students.filter(st => !st.device_id).length}  {t("chưa ghép ·")} {students.filter(st => st.device_id && !st.online).length}  {t("mất kết nối")}</p>
        {!online.length ? <p className="pairing-empty">{unassigned.length ? t("{length} thiết bị đã vào nhưng chưa có học sinh. Mở quản lý thiết bị để ghép.", { length: unassigned.length }) : t("Chưa có học sinh kết nối. Nhập ROOM ID trong chương trình thiết bị.")}</p> : <ul className="pairing-students" aria-label={t("Học sinh đang kết nối")}>
          {online.map(st => <li key={st.id}><span className="avatar">{st.student_code}</span><div><strong>{st.full_name}</strong><small>{st.label} · {st.device_id.slice(-6)}</small></div><span className="badge">{t("Đã kết nối")}</span></li>)}
        </ul>}
        {unassigned.length > 0 && online.length > 0 && <p role="status">{unassigned.length}  {t("thiết bị chưa ghép — chọn học sinh trong quản lý thiết bị.")}</p>}
      </div>
    </div>
    <details className="pairing-management" open={unassigned.length > 0 ? true : undefined}>
      <summary>{t("Quản lý thiết bị & sửa ghép học sinh (")}{devices.length})</summary>
      {!devices.length ? <p>{t("Chưa có thiết bị vào phòng.")}</p> : <div className="table-scroll"><table>
        <thead><tr><th>{t("Thiết bị")}</th><th>{t("Học sinh")}</th><th>{t("Kết nối")}</th><th>{t("Bấm thử")}</th><th>{t("Thao tác")}</th></tr></thead>
        <tbody>{devices.map(d => <tr key={d.id}>
          <td><strong>{d.label}</strong><small className="device-id-hint">Device ID: {d.id.slice(-8)}</small></td>
          <td>{editable && !d.revoked ? <select aria-label={t("Ghép học sinh cho {label}", { label: d.label })} value={d.session_student_id || ""} disabled={busy || !connected} onChange={e => {
            const studentId = e.target.value || null;
            execute(async () => { await api(`/sessions/${s.id}/room-devices/${d.id}/student`, "PUT", { student_id: studentId, expected_version: s.state_version }); }, t("Đã cập nhật ghép học sinh."));
          }}><option value="">{t("Chưa ghép học sinh")}</option>{students.filter(st => !st.device_id || st.id === d.session_student_id).map(st => <option key={st.id} value={st.id}>{st.student_code} · {st.full_name}</option>)}</select> : (s.students.find((st: Data) => st.id === d.session_student_id)?.full_name || t("Chưa ghép học sinh"))}</td>
          <td>{d.revoked ? t("Đã thu hồi") : d.online ? t("Đang kết nối") : t("Mất kết nối")}</td>
          <td>{d.tested_at ? `${d.test_choice} · ${new Date(d.tested_at).toLocaleTimeString(locale())}` : t("Chưa bấm thử")}</td>
          <td><button disabled={!editable || busy || !connected} onClick={() => {
            if (confirm(t("Gỡ {label} khỏi phòng? Thiết bị và đáp án đã lưu được giữ lại.", { label: d.label }))) execute(async () => { await api(`/sessions/${s.id}/room-devices/${d.id}`, "DELETE"); }, t("Đã gỡ thiết bị khỏi phòng."));
          }}>{t("Gỡ khỏi phòng")}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </details>
  </section>;
}
