import { createUuid } from "../uuid";
import { useEffect, useState } from "react";
import { api, fields, stateLabel, eventLabel, type Data } from "../api";
import {
  ChoiceShape,
  DeleteSessionButton,
  Empty,
  Field,
  Head,
  Icon,
  Status,
  useApp,
  useResource,
} from "../components";
import { useClock, useSessionSocket } from "../socket";
import { ConfigFields, readConfig } from "../quiz-config";
import { RoomPairing } from "./room-pairing";
import { t, locale } from "../i18n";
export function SessionPage({ id }: { id: string }) {
  const { run, user } = useApp(),
    initial = useResource(`/sessions/${id}`),
    devices = useResource<Data[]>("/devices"),
    live = useSessionSocket(id),
    [search, setSearch] = useState(""),
    [studentFilter, setStudentFilter] = useState("all"),
    [configOpen, setConfigOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const s = live.data || initial.data,
    time = useClock(s, live.offset);
  if (!s) return <Status loading error={initial.error} />;
  const ready = s.students.filter((st: Data) => !st.absent && st.online).length,
    participants = s.students.filter((st: Data) => !st.absent).length,
    unbound = s.students.filter((st: Data) => !st.absent && !st.device_id).length,
    offline = s.students.filter((st: Data) => !st.absent && st.device_id && !st.online).length,
    untested = s.students.filter((st: Data) => !st.absent && st.device_id && !st.tested_at).length,
    unanswered = s.question ? s.students.filter((st: Data) => !st.absent && !st.answer_received_at).length : 0,
    finished = ["FINISHED", "CANCELLED"].includes(s.state);
  const command = (action: string) => {
    if (busy) return;
    if (
      ["finish", "cancel"].includes(action) &&
      !confirm(
        action === "cancel"
          ? t("Hủy buổi? Dữ liệu giữ để tra cứu nhưng không có điểm chính thức.")
          : t("Kết thúc bài và chấm các câu đã mở? Câu chưa mở không được tính."),
      )
    )
      return;
    if (
      action === "start" &&
      ready < participants &&
      !confirm(
        t("Có {v} học sinh chưa kết nối. Vẫn bắt đầu với {participants} học sinh dự thi?", { v: participants - ready, participants }),
      )
    )
      return;
    setBusy(true);
    void run(async () => {
      await api(`/sessions/${id}/commands`, "POST", {
        command_id: createUuid(),
        expected_version: s.state_version,
        action,
      });
      initial.reload();
    }).finally(() => setBusy(false));
  };
  async function present() {
    const tab = window.open("about:blank", "_blank");
    if (!tab)
      throw Error(
        t("Trình duyệt chặn cửa sổ mới. Cho phép popup để mở màn hình chiếu."),
      );
    try {
      const result = await api(`/sessions/${id}/presentation-access`, "POST");
      tab.opener = null;
      tab.location.href = `/present/${id}#${result.token}`;
    } catch (e) {
      tab.close();
      throw e;
    }
  }
  return (
    <>
      <Head
        eyebrow={t("PHÒNG KIỂM TRA")}
        title={s.name}
        description={`${s.class_name} · ${stateLabel[s.state]} · ${s.config.auto_next ? t("Tự chuyển câu") : t("Giáo viên chuyển câu")}`}
      >
        {!finished && (
          <button onClick={() => void run(present)}>
            <Icon name="arrow" />  {t("Mở màn hình chiếu ↗")}
          </button>
        )}
        {finished && (
          <a className="button primary" href={`/reports/${id}`}>
            
            {t("Xem báo cáo →")}
          </a>
        )}
        <DeleteSessionButton id={id} name={s.name} state={s.state} />
      </Head>
      <div
        className={`connection ${live.status === t("Đã kết nối") ? "" : "warning"}`}
        role="status"
      >
        ● {live.status} · {stateLabel[s.state]}
        {live.status !== t("Đã kết nối") && (
          <>  {t("· Dữ liệu có thể đã cũ")}{live.syncedAt ? t(" (đồng bộ lần cuối {v})", { v: new Date(live.syncedAt).toLocaleTimeString(locale()) }) : ""}<button onClick={live.reconnect}>{t("Kết nối lại")}</button></>
        )}
      </div>
      {s.state === "LOBBY" && <section className="card preflight" aria-label={t("Kiểm tra phòng trước khi bắt đầu")}>
        <h2>{t("Kiểm tra phòng trước khi bắt đầu")}</h2>
        <div className="preflight-grid">
          <div><small>{t("Đề & thời gian")}</small><strong>{s.config.count}  {t("câu ·")} {s.config.seconds}  {t("giây/câu")}</strong><span>{s.config.auto_next ? t("Tự chuyển câu") : t("Giáo viên chuyển câu")}  {t("· Đạt từ")} {s.config.pass_mark}/10</span></div>
          <div><small>{t("Học sinh")}</small><strong>{participants}  {t("dự thi ·")} {s.students.length - participants}  {t("vắng")}</strong><span>{unbound ? t("{unbound} chưa ghép thiết bị", { unbound }) : t("Đã ghép đủ học sinh dự thi")}</span></div>
          <div><small>{t("Thiết bị")}</small><strong>{ready}/{participants}  {t("đang kết nối")}</strong><span>{!participants ? t("Chưa có học sinh dự thi") : untested ? t("{untested} chưa bấm thử trong buổi", { untested }) : unbound === participants ? t("Chưa ghép thiết bị") : t("Đã bấm thử tất cả thiết bị đã ghép")}</span></div>
          <div><small>{t("Màn chiếu")}</small><strong>{s.projection_online ? t("Đang kết nối") : t("Chưa phát hiện")}</strong><span>{s.projection_online ? t("Cửa sổ trình chiếu đã mở") : t("Mở màn hình chiếu và kiểm tra hình ảnh")}</span></div>
        </div>
      </section>}
      {s.state !== "LOBBY" && !finished && <section className="card live-controls" aria-label={t("Điều khiển bài kiểm tra")}>
        <div className="live-metric"><Icon name="file" /><span><strong>{t("Câu")} {s.question?.question_order || 0}/{s.config.count}</strong><small>{s.question?.status === "OPEN" ? t("Đang nhận đáp án") : s.state === "PAUSED" ? t("Đã tạm dừng") : s.config.auto_next ? t("Đang chờ tự chuyển") : t("Chờ giáo viên chuyển")}</small></span></div>
        <div className="live-metric"><Icon name="clock" /><span><strong>{time}  {t("giây")}</strong><small>{s.state === "PAUSED" ? t("Đồng hồ tạm dừng") : t("Thời gian còn lại")}</small></span></div>
        <div className="live-metric"><Icon name="users" /><span><strong>{s.answered}/{s.participants}</strong><small>{t("Đã lưu đáp án / dự thi")}</small></span></div>
        <div className="live-buttons">
          {s.state === "PAUSED" ? <button className="primary" disabled={busy || live.status !== t("Đã kết nối")} onClick={() => command("resume")}>{t("▶ Tiếp tục")}</button> : <>
            {s.question?.status === "OPEN" && <button className="primary" disabled={busy || live.status !== t("Đã kết nối")} onClick={() => command("close-question")}>{t("Đóng câu")}</button>}
            {s.config.auto_next
              ? s.question?.status === "CLOSED" && <button className="primary" disabled>{t("Tự chuyển sau 3 giây")}</button>
              : <button className={s.question?.status === "CLOSED" ? "primary" : ""} disabled={busy || live.status !== t("Đã kết nối") || s.question?.status !== "CLOSED"} title={s.question?.status !== "CLOSED" ? t("Đóng câu hiện tại trước khi chuyển câu.") : undefined} onClick={() => command("next")}>{t("Câu tiếp theo →")}</button>}
            <button disabled={busy || live.status !== t("Đã kết nối")} onClick={() => command("pause")}>{t("Ⅱ Tạm dừng")}</button>
          </>}
        </div>
      </section>}
      {s.state !== "LOBBY" && !finished && <div className="live-alerts" role="status">
        <span className={s.projection_online ? "ok" : "attention"}>{t("Màn chiếu:")} {s.projection_online ? t("đang kết nối") : t("mất kết nối")}</span>
        {offline > 0 && <span className="attention">{offline}  {t("thiết bị mất kết nối · kiểm tra danh sách bên dưới")}</span>}
        {s.question?.status === "OPEN" && <span>{unanswered}  {t("học sinh chưa có đáp án được lưu")}</span>}
      </div>}
      {s.question && (
        <section className="card current-question">
          <div className="row spread">
            <span className="badge">{t("Câu")} {s.question.question_order}/{s.config.count} · {stateLabel[s.question.status]}</span>
            <strong className="countdown">{time}s</strong>
          </div>
          <h2>{s.question.question}</h2>
          <div className="answer-grid">
            {(["A", "B", "C", "D"] as const).map((c) => <div key={c} className={`choice-${c.toLowerCase()}`}><b>{c}</b> {s.question[`option_${c.toLowerCase()}`]}</div>)}
          </div>
          <p className="question-hint" role="status">{finished ? t("Buổi đã kết thúc. Xem báo cáo để kiểm tra kết quả.") : s.state === "PAUSED" ? t("Bài đang tạm dừng. Tiếp tục khi lớp đã sẵn sàng.") : s.question.status === "CLOSED" ? s.config.auto_next ? t("Câu đã đóng. Hệ thống sẽ chuyển câu sau 3 giây.") : t("Câu đã đóng. Giáo viên bấm Câu tiếp theo để tiếp tục.") : t("{answered}/{participants} học sinh đã trả lời.", { answered: s.answered, participants: s.participants })}</p>
        </section>
      )}
      {s.question?.status === "CLOSED" && !finished && <section className="card teacher-choices" aria-label={t("Phân bố đáp án")}>
        <h2>{t("Phân bố lựa chọn")} {s.question.results ? t("· đã công bố") : t("· chỉ giáo viên")}</h2>
        <div className="choice-counts">
          {(["A", "B", "C", "D"] as const).map((c) => <span key={c} className={`choice-${c.toLowerCase()}`}>{c}: <b>{s.students.filter((st: Data) => !st.absent && st.answer_choice === c).length}</b></span>)}
          <span>{t("Bỏ trống:")} <b>{unanswered}</b></span>
        </div>
        <small>{s.question.results ? t("Đã công bố phân bố và đáp án đúng trên màn chiếu.") : t("Chưa hiện trên màn chiếu. Chỉ tính câu đã đóng.")}</small>
        <div className="actions"><button disabled={busy || live.status !== t("Đã kết nối") || !!s.question.results} onClick={() => command("reveal-results")}>{s.question.results ? t("Đã công bố trên màn chiếu") : t("Công bố kết quả trên màn chiếu")}</button></div>
      </section>}
      {s.leaderboard_full?.length > 0 && (
        <section className="card leaderboard-card" aria-label={t("Bảng xếp hạng thi đua")}>
          <div className="row spread">
            <h2><Icon name="chart" />  {t("Bảng xếp hạng thi đua")}</h2>
            <small className="muted">
              {finished ? t("Kết quả cuối buổi") : s.question?.results ? t("Top 5 đang hiện trên màn chiếu") : t("Màn chiếu hiện top 5 khi công bố kết quả")}
            </small>
          </div>
          <ol className="leaderboard">
            {s.leaderboard_full.slice(0, 10).map((r: Data) => (
              <li key={r.student_id}>
                <span className="lb-rank">{r.rank}</span>
                <span className="lb-name">
                  {r.full_name}
                  <small>{r.correct}  {t("câu đúng")}{r.streak >= 2 ? t(" · đang chuỗi {streak}", { streak: r.streak }) : ""}</small>
                </span>
                {r.last_gain > 0 && <span className="lb-gain">+{r.last_gain}</span>}
                <strong>{r.points.toLocaleString(locale())}</strong>
              </li>
            ))}
          </ol>
          {s.leaderboard_full.length > 10 && <small className="muted">{t("… và")} {s.leaderboard_full.length - 10}  {t("học sinh khác")}</small>}
        </section>
      )}
      {s.state === "LOBBY" && <ol className="setup-steps" aria-label={t("Các bước chuẩn bị bài")}><li className="selected">{t("1. Lớp và bộ đề")}</li><li className="selected">{t("2. Cấu hình")}</li><li className="selected">{t("3. Ghép thiết bị")}</li><li>{t("4. Sẵn sàng")}</li></ol>}
      {!finished && <RoomPairing session={s} offset={live.offset} connected={live.status === t("Đã kết nối")} reload={() => { initial.reload(); devices.reload(); }} />}
      <div className={`room-grid ${s.state === "LOBBY" ? "" : finished ? "is-finished" : "is-live"}`}>
        {s.state === "LOBBY" && <section className="hero session-hero">
          <div className="row spread">
            <span className="hero-pill">
              {s.class_name.toUpperCase()}  {t("· KIỂM TRA")}
            </span>
            <small>
              
              {t("HỌC CÙNG NHAU")}
              <br />
              
              {t("TIẾN XA HƠN —")}
            </small>
          </div>
          <h2>{s.name}</h2>
          <div className="hero-stats">
            <div>
              <Icon name="file" />
              <span>
                <b>{s.config.count}</b>
                <small>{t("câu hỏi")}</small>
              </span>
            </div>
            <div>
              <Icon name="clock" />
              <span>
                <b>{s.config.seconds}  {t("giây")}</b>
                <small>{t("/ câu")}</small>
              </span>
            </div>
            <div>
              <span className="shuffle">⤨</span>
              <span>
                <b>{s.config.random ? t("Ngẫu nhiên") : t("Theo thứ tự")}</b>
                <small>{t("chọn câu hỏi")}</small>
              </span>
            </div>
          </div>
          <div className="actions controls">
            {s.state === "LOBBY" && (
              <>
                <button
                  className="primary"
                  disabled={busy || live.status !== t("Đã kết nối")}
                  onClick={() => command("start")}
                >
                  
                  {t("▶ Bắt đầu kiểm tra")}
                </button>
                <button
                  className="hero-link"
                  onClick={() => setConfigOpen(!configOpen)}
                >
                  <Icon name="settings" />  {t("Chỉnh cấu hình")}
                </button>
              </>
            )}
          </div>
        </section>}
        {!finished && <section className="card connection-card">
          <h2>
            <Icon name="users" />  {t("Kết nối lớp học")}
          </h2>
          <div className="readiness">
            <div>
              <p>
                <span className="dot" /> <b>{ready}</b>  {t("đã kết nối")}
              </p>
              <p>
                <span className="dot amber" /> <b>{participants - ready}</b>{" "}
                
                {t("chưa kết nối")}
              </p>
              <p className="muted">
                {s.students.length - participants}  {t("học sinh vắng")}
              </p>
            </div>
            <div
              className="ring"
              style={
                {
                  "--progress": `${participants ? (ready / participants) * 100 : 0}%`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {ready}/{participants}
                </strong>
                <small>
                  
                  {t("học sinh")}
                  <br />
                  
                  {t("đã sẵn sàng")}
                </small>
              </div>
            </div>
          </div>
          <div className="connection-foot">
            <small>
              {s.state === "LOBBY"
                ? t("Kiểm tra kết nối trước khi bắt đầu.")
                : s.state === "PAUSED"
                  ? t("Có thể ghép lại thiết bị rồi tiếp tục.")
                  : t("Muốn thay thiết bị, hãy tạm dừng bài trước.")}
            </small>
            {user.simulator && (
              <a
                className="button"
                href="/simulator"
                target="_blank"
                rel="noreferrer"
              >
                
                {t("Kiểm tra thiết bị ↗")}
              </a>
            )}
          </div>
        </section>}
        <section className="card students-card">
          <div className="row spread">
            <h2>
              <Icon name="users" />  {t("Học sinh trong phòng")}{" "}
              <span className="badge">{s.students.length}  {t("học sinh")}</span>
            </h2>
            <div className="student-tools">
              <select aria-label={t("Lọc học sinh theo trạng thái")} value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
                <option value="all">{t("Tất cả")}</option><option value="answered">{t("Đã lưu câu này")}</option><option value="unanswered">{t("Chưa lưu câu này")}</option><option value="unbound">{t("Chưa ghép")}</option><option value="offline">{t("Mất kết nối")}</option><option value="absent">{t("Vắng")}</option>
              </select>
              <input aria-label={t("Tìm học sinh trong phòng")} placeholder={t("Tìm học sinh…")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {s.state === "LOBBY" && (
            <div className="row pairing-action">
              <button
                onClick={() => {
                  const management = document.querySelector<HTMLDetailsElement>(".pairing-management");
                  if (management) {
                    management.open = true;
                    management.scrollIntoView({ behavior: "smooth" });
                  }
                }}
              >
                
                {t("Mở quản lý ghép thiết bị thủ công")}
              </button>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Học sinh")}</th>
                  <th>{t("Thiết bị")}</th>
                  <th>{t("Trạng thái")}</th>
                  <th>{t("Câu hiện tại")}</th>
                  <th>{t("Ghi nhận gần nhất")}</th>
                  <th>{t("Vắng")}</th>
                </tr>
              </thead>
              <tbody>
                {s.students
                  .filter((st: Data) =>
                    (st.full_name + st.student_code)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .filter((st: Data) => studentFilter === "all" || (studentFilter === "absent" ? !!st.absent : studentFilter === "unbound" ? !st.absent && !st.device_id : studentFilter === "offline" ? !st.absent && !!st.device_id && !st.online : studentFilter === "answered" ? !!s.question && !st.absent && !!st.answer_received_at : !!s.question && !st.absent && !st.answer_received_at))
                  .map((st: Data) => (
                    <tr key={st.id}>
                      <td>
                        <div className="student-name">
                          <span className="avatar">
                            {st.full_name
                              .split(" ")
                              .slice(-2)
                              .map((n: string) => n[0])
                              .join("")}
                          </span>
                          <span>
                            {st.full_name}
                            <small>{st.student_code}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {["LOBBY", "PAUSED"].includes(s.state) ? (
                          <select
                            aria-label={t("Thiết bị của {full_name}", { full_name: st.full_name })}
                            value={st.device_id || ""}
                            disabled={!!st.absent}
                            onChange={(e) =>
                              void run(async () => {
                                await api(
                                  `/sessions/${id}/bindings/${st.id}`,
                                  "PUT",
                                  { device_id: e.target.value || null },
                                );
                                initial.reload();
                              })
                            }
                          >
                            <option value="">{t("Chưa ghép")}</option>
                            {Array.from(new Map([...(devices.data ?? []), ...(s.room_devices ?? [])].map((d: Data) => [d.id, d])).values())
                              ?.filter((d) => !d.revoked &&
                                (!d.assigned_session || d.id === st.device_id) &&
                                !s.students.some((other: Data) => other.id !== st.id && other.device_id === d.id))
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.label} · {d.id.slice(-6)}
                                </option>
                              ))}
                          </select>
                        ) : (
                          st.device_id ? `${st.label || t("Thiết bị")} · ${st.device_id.slice(-6)}` : "—"
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-text ${st.absent ? "muted" : st.online ? "green" : "amber-text"}`}
                        >
                          {st.absent
                            ? t("Vắng")
                            : finished
                              ? t("Đã kết thúc")
                              : st.online
                                ? t("● Sẵn sàng")
                                : st.device_id
                                  ? t("● Chưa kết nối")
                                  : t("Chưa ghép")}
                        </span>
                      </td>
                      <td>{st.absent ? t("Vắng") : !s.question ? t("Chưa mở câu") : st.answer_received_at ? t("Đã lưu đáp án") : t("Chưa lưu đáp án")}</td>
                      <td>{st.answer_received_at ? t("Lưu lúc {v}", { v: new Date(st.answer_received_at).toLocaleTimeString(locale()) }) : st.last_seen ? t("Thiết bị thấy lúc {v}", { v: new Date(st.last_seen).toLocaleTimeString(locale()) }) : t("Chưa ghi nhận thiết bị")}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t("Vắng: {full_name}", { full_name: st.full_name })}
                          checked={!!st.absent}
                          disabled={s.state !== "LOBBY"}
                          onChange={(e) =>
                            void run(async () => {
                              await api(
                                `/sessions/${id}/students/${st.id}`,
                                "PATCH",
                                { absent: e.target.checked },
                              );
                              initial.reload();
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!s.students.length && (
            <Empty>
              
              {t("Lớp chưa có học sinh lúc tạo phòng. Hủy phòng, bổ sung lớp rồi tạo lại.")}
            </Empty>
          )}
        </section>
        <section className="card settings-card">
          <h2>
            <Icon name="file" />  {t("Bộ câu hỏi")}
          </h2>
          <a className="bank-link" href={`/question-banks/${s.bank_id}`}>
            <span className="file-mark">X</span>
            <div>
              <strong>{t("Xem và chỉnh sửa bộ đề")}</strong>
              <small>{t("Bài đã bắt đầu dùng bản sao riêng")}</small>
            </div>
            <span>→</span>
          </a>
          <hr />
          <h2>
            <Icon name="settings" />  {t("Thiết lập nhanh")}
          </h2>
          {configOpen && s.state === "LOBBY" ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = fields(e.currentTarget);
                void run(async () => {
                  await api(`/sessions/${id}`, "PATCH", {
                    name: f.name,
                    config: readConfig(f),
                    expected_version: s.state_version,
                  });
                  setConfigOpen(false);
                  initial.reload();
                }, t("Đã lưu cấu hình."));
              }}
            >
              <Field label={t("Tên buổi")}>
                <input name="name" defaultValue={s.name} required />
              </Field>
              <ConfigFields config={s.config} />
              <button className="primary">{t("Lưu cấu hình")}</button>
            </form>
          ) : (
            <>
              <div className="settings-summary">
                <span>
                  
                  {t("Số câu")} <b>{s.config.count}</b>
                </span>
                <span>
                  
                  {t("Thời gian")} <b>{s.config.seconds}  {t("giây")}</b>
                </span>
              </div>
              <p>
                
                {t("Đổi đáp án:")}{" "}
                <b>{s.config.allow_change ? t("Đến hết giờ") : t("Khóa lần đầu")}</b>
              </p>
              <p>
                
                {t("Chuyển câu:")}{" "}
                <b>
                  {s.config.auto_next
                    ? t("Tự động sau 3 giây")
                    : t("Giáo viên chuyển")}
                </b>
              </p>
              <p>
                
                {t("Ngưỡng đạt:")} <b>{s.config.pass_mark}/10</b>
              </p>
              <div className="mode">{t("Kiểm tra")}</div>
            </>
          )}
        </section>
      </div>
      <details className="card">
        <summary>{t("Nhật ký kết nối và thao tác")}</summary>
        {s.events?.map((e: Data) => {
          const detail = JSON.parse(e.detail);
          return (
            <div className="event" key={e.id}>
              <time>{new Date(e.created_at).toLocaleTimeString(locale())}</time>
              <span>
                {eventLabel[e.type] || t("Sự kiện buổi kiểm tra")}{" "}
                {detail.device_id
                  ? devices.data?.find((d) => d.id === detail.device_id)?.label
                  : ""}{" "}
                {detail.choice || ""} {detail.message || ""}
              </span>
            </div>
          );
        })}
      </details>
      <div className="actions no-print">
        {!finished && (
          <>
            {s.state !== "LOBBY" && <button onClick={() => command("finish")}>{t("Kết thúc và chấm bài")}</button>}
            <button className="danger" onClick={() => command("cancel")}>
              
              {t("Hủy buổi")}
            </button>
            <button
              onClick={() =>
                void run(
                  () => api(`/sessions/${id}/presentation-access`, "DELETE"),
                  t("Đã đóng quyền trình chiếu."),
                )
              }
            >
              
              {t("Thu hồi màn hình chiếu")}
            </button>
          </>
        )}
        <a href={`/reports/${id}`}>{t("Xem dữ liệu báo cáo →")}</a>
      </div>
    </>
  );
}
export function Presentation({ id }: { id: string }) {
  const [grant, setGrant] = useState<string | null>(
      sessionStorage.getItem(`projection:${id}`),
    ),
    [error, setError] = useState("");
  useEffect(() => {
    const bootstrap = location.hash.slice(1);
    if (bootstrap) {
      history.replaceState(null, "", location.pathname);
      api("/presentation/exchange", "POST", { token: bootstrap })
        .then((result) => {
          if (result.session_id !== id)
            throw Error(t("Quyền trình chiếu không đúng buổi"));
          sessionStorage.setItem(`projection:${id}`, result.token);
          setGrant(result.token);
        })
        .catch((e) => setError(e.message));
    } else if (!grant)
      setError(t("Mở màn hình chiếu từ bảng điều khiển giáo viên."));
  }, [id]);
  if (error)
    return (
      <main className="presentation">
        <Status error={error} />
      </main>
    );
  if (!grant)
    return (
      <main className="presentation">
        <Status loading />
      </main>
    );
  return <ProjectionView id={id} token={grant} />;
}
function ProjectionView({ id, token }: { id: string; token: string }) {
  const live = useSessionSocket(id, token),
    s = live.data,
    time = useClock(s, live.offset),
    [nextPending, setNextPending] = useState(false),
    [nextError, setNextError] = useState("");
  useEffect(() => {
    if (!live.controlResult) return;
    setNextPending(false);
    setNextError(live.controlResult.ok ? "" : live.controlResult.message || t("Không thể chuyển câu."));
  }, [live.controlResult]);
  function nextQuestion() {
    if (!s) return;
    setNextError("");
    setNextPending(true);
    if (!live.sendProjectionNext(createUuid(), s.state_version)) {
      setNextPending(false);
      setNextError(t("Màn hình trình chiếu đang mất kết nối. Hãy thử lại khi đã kết nối."));
    }
  }
  return (
    <main className="presentation">
      <header>
        <a href="#" onClick={(e) => e.preventDefault()} className="brand">
          <Icon name="book" />
          <span>
            SmartClass<small>{t("LỚP HỌC TƯƠNG TÁC")}</small>
          </span>
        </a>
        <span>
          {s?.class_name} · {s?.name}
        </span>
        <button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          }}
        >
          
          {t("Toàn màn hình")}
        </button>
      </header>
      <div role="status" className="projection-status">
        {s && ["FINISHED", "CANCELLED"].includes(s.state)
          ? stateLabel[s.state]
          : live.status}
        {s &&
          !["FINISHED", "CANCELLED"].includes(s.state) &&
          ` · ${stateLabel[s.state]}`}
      </div>
      {!s ? (
        <Status loading={!live.status.startsWith(t("Quyền trình chiếu đã hết hạn"))} error={live.status.startsWith(t("Quyền trình chiếu đã hết hạn")) ? live.status : undefined} />
      ) : s.state === "LOBBY" ? (
        <div className="projection-wait">
          <p className="eyebrow">{t("SẴN SÀNG CHO GIỜ HỌC")}</p>
          <h1>{s.name}</h1>
          <p>{t("Quan sát màn hình. Chọn A, B, C hoặc D trên thiết bị.")}</p>
          <strong>{t("Chờ giáo viên bắt đầu")}</strong>
        </div>
      ) : s.state === "FINISHED" && s.leaderboard?.length ? (
        <Podium board={s.leaderboard} title={s.name} />
      ) : s.question ? (
        <>
          <div className="row spread">
            <p className="eyebrow">
              
              {t("CÂU")} {s.question.question_order} / {s.config.count} ·{" "}
              {stateLabel[s.question.status]}
            </p>
            <span className="project-timer">
              {s.state === "PAUSED" ? t("Tạm dừng · ") : ""}
              {time}s
            </span>
          </div>
          <h1 className="project-question">{s.question.question}</h1>
          <div className="project-options">
            {["A", "B", "C", "D"].map((c) => (
              <div
                key={c}
                className={`choice-${c.toLowerCase()}${s.question.results ? (c === s.question.results.correct_answer ? " is-correct" : " is-dim") : ""}`}
              >
                <b>{c}</b>
                <span>{s.question[`option_${c.toLowerCase()}`]}</span>
                <ChoiceShape choice={c} />
              </div>
            ))}
          </div>
          <div className={s.leaderboard?.length ? "project-reveal" : undefined}>
          {s.question.results && <section className="project-results" aria-label={t("Kết quả câu đã công bố")}>
            <h2>{t("Kết quả câu")} {s.question.question_order}  {t("· đáp án đúng")} {s.question.results.correct_answer}</h2>
            <div>{(["A", "B", "C", "D"] as const).map((c) => <span key={c} className={`choice-${c.toLowerCase()}${c === s.question.results.correct_answer ? " is-correct" : ""}`}><ChoiceShape choice={c} />{c}: <b>{s.question.results.counts[c]}</b></span>)}</div>
          </section>}
          {s.leaderboard?.length > 0 && (
            <section className="project-board" aria-label={t("Bảng xếp hạng")}>
              <h2>{t("Bảng xếp hạng")}</h2>
              <ol>
                {s.leaderboard.map((r: Data) => (
                  <li key={r.name}>
                    <span className="lb-rank">{r.rank}</span>
                    <span className="lb-name">
                      {r.name}
                      {r.streak >= 2 && <small className="lb-streak">{r.streak}  {t("câu liên tiếp")}</small>}
                    </span>
                    {r.last_gain > 0 && <span className="lb-gain">+{r.last_gain}</span>}
                    <strong>{r.points.toLocaleString(locale())}</strong>
                  </li>
                ))}
              </ol>
            </section>
          )}
          </div>
          <footer>
            {s.answered}/{s.participants}  {t("học sinh đã trả lời")}
            {s.state === "PAUSED" ? t(" · Bài đang tạm dừng") : s.question.status === "CLOSED" ? s.config.auto_next ? t(" · Hết giờ, sắp chuyển câu") : t(" · Hết giờ, chờ giáo viên chuyển câu") : ""}
            {["FINISHED", "CANCELLED"].includes(s.state) &&
              t(" · Buổi đã kết thúc")}
          </footer>
          {!s.config.auto_next && s.state === "RUNNING" && (
            <div className="projection-controls">
              <button
                className="primary"
                disabled={nextPending || live.status !== t("Đã kết nối") || s.question.status !== "CLOSED"}
                onClick={nextQuestion}
              >
                {nextPending ? t("Đang chuyển câu…") : t("Câu tiếp theo →")}
              </button>
              {nextError && <p role="alert">{nextError}</p>}
            </div>
          )}
        </>
      ) : (
        <h1>{stateLabel[s.state]}</h1>
      )}
    </main>
  );
}

// Final ranking: 2nd, 1st, 3rd on steps; places 4–5 listed underneath.
function Podium({ board, title }: { board: Data[]; title: string }) {
  const steps = [board[1], board[0], board[2]]
    .map((r, i) => r && { ...r, place: [2, 1, 3][i] })
    .filter(Boolean) as Data[];
  return (
    <div className="podium-wrap">
      <p className="eyebrow">{t("KẾT QUẢ THI ĐUA")}</p>
      <h1>{title}</h1>
      <div className="podium">
        {steps.map((r) => (
          <div key={r.name} className={`podium-step place-${r.place}`}>
            <span className="podium-name">{r.name}</span>
            <span className="podium-points">{r.points.toLocaleString(locale())}  {t("điểm")}</span>
            <div className="podium-block">{r.rank}</div>
          </div>
        ))}
      </div>
      {board.length > 3 && (
        <ol className="podium-rest">
          {board.slice(3).map((r) => (
            <li key={r.name}>
              <span className="lb-rank">{r.rank}</span>
              <span className="lb-name">{r.name}</span>
              <strong>{r.points.toLocaleString(locale())}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
