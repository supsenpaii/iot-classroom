import { useEffect, useState } from "react";
import { api, type Data } from "../api";
import { useApp } from "../components";

export function RoomPairing({ session: s, offset, connected, reload }: { session: Data; offset: number; connected: boolean; reload: () => void }) {
  const { run, user } = useApp();
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState(false), [autoAssign, setAutoAssign] = useState(true);
  const p = s.pairing;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  useEffect(() => { if (p?.status === "OPEN") setAutoAssign(!!p.auto_assign); }, [p?.status, p?.auto_assign]);
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
      command_id: crypto.randomUUID(), expected_version: s.state_version, ...(action === "open" ? { auto_assign: autoAssign } : {}),
    });
  }, action === "open" ? "Đã mở nhận thiết bị trong 5 phút." : "Đã đóng nhận thiết bị mới.");
  return <section className="card room-pairing" aria-label="Kết nối bằng ROOM ID">
    <div className="row spread">
      <div><h2>Kết nối lớp học bằng ROOM ID</h2><p className="muted">Mở nhận → nhập mã trên thiết bị → học sinh hiện ngay khi kết nối.</p></div>
      {user.simulator && <a className="button" href="/simulator" target="_blank" rel="noreferrer">Mở giả lập ↗</a>}
    </div>
    <div className="pairing-layout">
      <div className="pairing-entry">
        <span className="badge">{open ? "Đang nhận thiết bị" : p?.status === "EXPIRED" || (p?.status === "OPEN" && !remaining) ? "Mã hết hạn" : "Chưa mở nhận thiết bị"}</span>
        {open ? <div role="status"><strong className="pairing-code">{p.room_code.slice(0, 4)} {p.room_code.slice(4)}</strong><p>Còn {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} · Mã dùng chung cho cả lớp</p></div> : <p>{editable ? "Nhấn Mở nhận thiết bị để tạo mã 8 chữ số." : "Bài đang chạy. Tạm dừng để nhận thêm thiết bị."}</p>}
        {editable && <label className="check"><input type="checkbox" checked={autoAssign} disabled={open || busy} onChange={e => setAutoAssign(e.target.checked)} /> Tự ghép học sinh khi thiết bị vào</label>}
        <p className="muted pairing-help">{(open ? p.auto_assign : autoAssign) ? "Ghép lần lượt theo mã học sinh, bỏ qua bạn vắng/đã có thiết bị. Kiểm tra tên sau khi vào; có thể sửa ghép bên dưới." : "Thiết bị tự vào phòng; chọn học sinh trong quản lý thiết bị bên dưới."}</p>
        <div className="actions">
          {editable && !open && <button className="primary" disabled={busy || !connected} onClick={() => command("open")}>Mở nhận thiết bị</button>}
          {open && <button className="primary" onClick={() => void run(() => navigator.clipboard.writeText(p.room_code), "Đã sao chép ROOM ID.")}>Sao chép mã</button>}
          {editable && open && <button disabled={busy || !connected} onClick={() => command("close")}>Đóng nhận</button>}
        </div>
        {editable && open && <button className="text-button" disabled={busy || !connected} onClick={() => command("open")}>Tạo mã mới</button>}
        <small className="muted">Đóng nhận không ngắt thiết bị đã kết nối.</small>
      </div>
      <div className="pairing-roster">
        <div className="row spread"><h3>Học sinh đã kết nối</h3><strong aria-live="polite">{online.length}/{students.length}</strong></div>
        <p className="muted">{students.filter(st => !st.device_id).length} chưa ghép · {students.filter(st => st.device_id && !st.online).length} mất kết nối</p>
        {!online.length ? <p className="pairing-empty">{unassigned.length ? `${unassigned.length} thiết bị đã vào nhưng chưa có học sinh. Mở quản lý thiết bị để ghép.` : "Chưa có học sinh kết nối. Nhập ROOM ID trong chương trình thiết bị."}</p> : <ul className="pairing-students" aria-label="Học sinh đang kết nối">
          {online.map(st => <li key={st.id}><span className="avatar">{st.student_code}</span><div><strong>{st.full_name}</strong><small>{st.label} · {st.device_id.slice(-6)}</small></div><span className="badge">Đã kết nối</span></li>)}
        </ul>}
        {unassigned.length > 0 && online.length > 0 && <p role="status">{unassigned.length} thiết bị chưa ghép — chọn học sinh trong quản lý thiết bị.</p>}
      </div>
    </div>
    <details className="pairing-management" open={unassigned.length > 0 ? true : undefined}>
      <summary>Quản lý thiết bị &amp; sửa ghép học sinh ({devices.length})</summary>
      {!devices.length ? <p>Chưa có thiết bị vào phòng.</p> : <div className="table-scroll"><table>
        <thead><tr><th>Thiết bị</th><th>Học sinh</th><th>Kết nối</th><th>Bấm thử</th><th>Thao tác</th></tr></thead>
        <tbody>{devices.map(d => <tr key={d.id}>
          <td><strong>{d.label}</strong><small className="device-id-hint">Device ID: {d.id.slice(-8)}</small></td>
          <td>{editable && !d.revoked ? <select aria-label={`Ghép học sinh cho ${d.label}`} value={d.session_student_id || ""} disabled={busy || !connected} onChange={e => {
            const studentId = e.target.value || null;
            execute(async () => { await api(`/sessions/${s.id}/room-devices/${d.id}/student`, "PUT", { student_id: studentId, expected_version: s.state_version }); }, "Đã cập nhật ghép học sinh.");
          }}><option value="">Chưa ghép học sinh</option>{students.filter(st => !st.device_id || st.id === d.session_student_id).map(st => <option key={st.id} value={st.id}>{st.student_code} · {st.full_name}</option>)}</select> : (s.students.find((st: Data) => st.id === d.session_student_id)?.full_name || "Chưa ghép học sinh")}</td>
          <td>{d.revoked ? "Đã thu hồi" : d.online ? "Đang kết nối" : "Mất kết nối"}</td>
          <td>{d.tested_at ? `${d.test_choice} · ${new Date(d.tested_at).toLocaleTimeString("vi-VN")}` : "Chưa bấm thử"}</td>
          <td><button disabled={!editable || busy || !connected} onClick={() => {
            if (confirm(`Gỡ ${d.label} khỏi phòng? Thiết bị và đáp án đã lưu được giữ lại.`)) execute(async () => { await api(`/sessions/${s.id}/room-devices/${d.id}`, "DELETE"); }, "Đã gỡ thiết bị khỏi phòng.");
          }}>Gỡ khỏi phòng</button></td>
        </tr>)}</tbody>
      </table></div>}
    </details>
  </section>;
}
