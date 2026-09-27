import { useEffect, useState } from "react";
import { api, fields, stateLabel, eventLabel, type Data } from "../api";
import {
  Empty,
  Field,
  Head,
  Icon,
  Status,
  useApp,
  useResource,
} from "../components";
import { useClock, useSessionSocket } from "../socket";
import { ConfigFields, readConfig } from "./manage";
export function SessionPage({ id }: { id: string }) {
  const { run, user } = useApp(),
    initial = useResource(`/sessions/${id}`),
    devices = useResource<Data[]>("/devices"),
    live = useSessionSocket(id),
    [search, setSearch] = useState(""),
    [configOpen, setConfigOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const s = live.data || initial.data,
    time = useClock(s, live.offset);
  if (!s) return <Status loading error={initial.error} />;
  const ready = s.students.filter((st: Data) => !st.absent && st.online).length,
    participants = s.students.filter((st: Data) => !st.absent).length,
    finished = ["FINISHED", "CANCELLED"].includes(s.state);
  const command = (action: string) => {
    if (busy) return;
    if (
      ["finish", "cancel"].includes(action) &&
      !confirm(
        action === "cancel"
          ? "Hủy buổi? Dữ liệu giữ để tra cứu nhưng không có điểm chính thức."
          : "Kết thúc bài và chấm các câu đã mở? Câu chưa mở không được tính.",
      )
    )
      return;
    if (
      action === "start" &&
      ready < participants &&
      !confirm(
        `Có ${participants - ready} học sinh chưa kết nối. Vẫn bắt đầu với ${participants} học sinh dự thi?`,
      )
    )
      return;
    setBusy(true);
    void run(async () => {
      await api(`/sessions/${id}/commands`, "POST", {
        command_id: crypto.randomUUID(),
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
        "Trình duyệt chặn cửa sổ mới. Cho phép popup để mở màn hình chiếu.",
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
        eyebrow="PHÒNG KIỂM TRA"
        title={
          s.state === "LOBBY"
            ? "Sẵn sàng cho giờ học."
            : s.state === "PAUSED"
              ? "Tạm dừng để kết nối lại."
              : finished
                ? "Giờ học đã khép lại."
                : "Mỗi lựa chọn đều được ghi nhận."
        }
        description="Mỗi câu trả lời đều được lắng nghe."
      >
        {!finished && (
          <button onClick={() => void run(present)}>
            <Icon name="arrow" /> Mở màn hình chiếu ↗
          </button>
        )}
        {finished && (
          <a className="button primary" href={`/reports/${id}`}>
            Xem báo cáo →
          </a>
        )}
      </Head>
      <div
        className={`connection ${live.status === "Đã kết nối" ? "" : "warning"}`}
        role="status"
      >
        ● {live.status} · {stateLabel[s.state]}
        {live.status !== "Đã kết nối" && (
          <button onClick={live.reconnect}>Kết nối lại</button>
        )}
      </div>
      <div className="room-grid">
        <section className="hero session-hero">
          <div className="row spread">
            <span className="hero-pill">
              {s.class_name.toUpperCase()} · KIỂM TRA
            </span>
            <small>
              HỌC CÙNG NHAU
              <br />
              TIẾN XA HƠN —
            </small>
          </div>
          <h2>{s.name}</h2>
          <div className="room-code">
            Mã phòng <strong>{s.room_code}</strong>
            <button
              className="text-button"
              onClick={() =>
                void run(
                  () => navigator.clipboard.writeText(s.room_code),
                  "Đã sao chép mã phòng.",
                )
              }
            >
              Sao chép
            </button>
          </div>
          <div className="hero-stats">
            <div>
              <Icon name="file" />
              <span>
                <b>{s.config.count}</b>
                <small>câu hỏi</small>
              </span>
            </div>
            <div>
              <Icon name="clock" />
              <span>
                <b>{s.config.seconds} giây</b>
                <small>/ câu</small>
              </span>
            </div>
            <div>
              <span className="shuffle">⤨</span>
              <span>
                <b>{s.config.random ? "Ngẫu nhiên" : "Theo thứ tự"}</b>
                <small>chọn câu hỏi</small>
              </span>
            </div>
          </div>
          <div className="actions controls">
            {s.state === "LOBBY" && (
              <>
                <button
                  className="primary"
                  disabled={busy || live.status !== "Đã kết nối"}
                  onClick={() => command("start")}
                >
                  ▶ Bắt đầu kiểm tra
                </button>
                <button
                  className="hero-link"
                  onClick={() => setConfigOpen(!configOpen)}
                >
                  <Icon name="settings" /> Chỉnh cấu hình
                </button>
              </>
            )}
            {s.state === "RUNNING" && (
              <>
                <button
                  className="primary"
                  disabled={busy || live.status !== "Đã kết nối"}
                  onClick={() =>
                    command(
                      s.question?.status === "OPEN" ? "close-question" : "next",
                    )
                  }
                >
                  {s.question?.status === "OPEN"
                    ? "Đóng câu"
                    : "Câu tiếp theo →"}
                </button>
                <button disabled={busy} onClick={() => command("pause")}>
                  Tạm dừng
                </button>
              </>
            )}
            {s.state === "PAUSED" && (
              <button
                className="primary"
                disabled={busy || live.status !== "Đã kết nối"}
                onClick={() => command("resume")}
              >
                ▶ Tiếp tục
              </button>
            )}
            {!["LOBBY", "FINISHED", "CANCELLED"].includes(s.state) && (
              <button
                className="hero-link"
                disabled={busy}
                onClick={() => command("finish")}
              >
                Kết thúc bài
              </button>
            )}
          </div>
        </section>
        <section className="card connection-card">
          <h2>
            <Icon name="users" /> Kết nối lớp học
          </h2>
          <div className="readiness">
            <div>
              <p>
                <span className="dot" /> <b>{ready}</b> đã kết nối
              </p>
              <p>
                <span className="dot amber" /> <b>{participants - ready}</b>{" "}
                chưa kết nối
              </p>
              <p className="muted">
                {s.students.length - participants} học sinh vắng
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
                  học sinh
                  <br />
                  đã sẵn sàng
                </small>
              </div>
            </div>
          </div>
          <div className="connection-foot">
            <small>
              {finished
                ? "Buổi đã kết thúc. Thiết bị đã được giải phóng."
                : "Có thể bắt đầu với học sinh đã kết nối."}
            </small>
            {user.simulator && (
              <a
                className="button"
                href="/simulator"
                target="_blank"
                rel="noreferrer"
              >
                Kiểm tra thiết bị ↗
              </a>
            )}
          </div>
        </section>
        <section className="card students-card">
          <div className="row spread">
            <h2>
              <Icon name="users" /> Học sinh trong phòng{" "}
              <span className="badge">{s.students.length} học sinh</span>
            </h2>
            <input
              aria-label="Tìm học sinh trong phòng"
              placeholder="Tìm học sinh…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {s.state === "LOBBY" && (
            <div className="row pairing-action">
              <button
                onClick={() =>
                  void run(async () => {
                    const fresh: Data[] = await api("/devices");
                    const free = fresh.filter(
                      (d) => !d.revoked && !d.assigned_session,
                    );
                    const unbound = s.students.filter(
                      (st: Data) => !st.absent && !st.device_id,
                    );
                    if (!unbound.length)
                      throw Error("Các học sinh dự thi đều đã ghép thiết bị");
                    if (free.length < unbound.length)
                      throw Error(
                        `Cần thêm ${unbound.length - free.length} thiết bị chưa ghép`,
                      );
                    await api(`/sessions/${id}/bindings`, "PUT", {
                      rows: unbound.map((st: Data, i: number) => ({
                        student_id: st.id,
                        device_id: free[i].id,
                      })),
                    });
                    devices.reload();
                    initial.reload();
                  }, "Đã ghép thiết bị theo thứ tự mã học sinh và nhãn thiết bị.")
                }
              >
                Ghép tự động học sinh chưa có thiết bị
              </button>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Học sinh</th>
                  <th>Thiết bị</th>
                  <th>Trạng thái</th>
                  <th>Vắng</th>
                </tr>
              </thead>
              <tbody>
                {s.students
                  .filter((st: Data) =>
                    (st.full_name + st.student_code)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
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
                            aria-label={`Thiết bị của ${st.full_name}`}
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
                            <option value="">Chưa ghép</option>
                            {devices.data
                              ?.filter((d) => !d.revoked)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.label}
                                </option>
                              ))}
                          </select>
                        ) : (
                          st.label || "—"
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-text ${st.absent ? "muted" : st.online ? "green" : "amber-text"}`}
                        >
                          {st.absent
                            ? "Vắng"
                            : finished
                              ? "Đã kết thúc"
                              : st.online
                                ? "● Sẵn sàng"
                                : st.device_id
                                  ? "● Chưa kết nối"
                                  : "Chưa ghép"}
                        </span>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Vắng: ${st.full_name}`}
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
              Lớp chưa có học sinh lúc tạo phòng. Hủy phòng, bổ sung lớp rồi tạo
              lại.
            </Empty>
          )}
        </section>
        <section className="card settings-card">
          <h2>
            <Icon name="file" /> Bộ câu hỏi
          </h2>
          <a className="bank-link" href={`/question-banks/${s.bank_id}`}>
            <span className="file-mark">X</span>
            <div>
              <strong>Xem và chỉnh sửa bộ đề</strong>
              <small>Bài đã bắt đầu dùng bản sao riêng</small>
            </div>
            <span>→</span>
          </a>
          <hr />
          <h2>
            <Icon name="settings" /> Thiết lập nhanh
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
                }, "Đã lưu cấu hình.");
              }}
            >
              <Field label="Tên buổi">
                <input name="name" defaultValue={s.name} required />
              </Field>
              <ConfigFields config={s.config} />
              <button className="primary">Lưu cấu hình</button>
            </form>
          ) : (
            <>
              <div className="settings-summary">
                <span>
                  Số câu <b>{s.config.count}</b>
                </span>
                <span>
                  Thời gian <b>{s.config.seconds} giây</b>
                </span>
              </div>
              <p>
                Đổi đáp án:{" "}
                <b>{s.config.allow_change ? "Đến hết giờ" : "Khóa lần đầu"}</b>
              </p>
              <p>
                Chuyển câu:{" "}
                <b>
                  {s.config.auto_next
                    ? "Tự động sau 3 giây"
                    : "Giáo viên chuyển"}
                </b>
              </p>
              <p>
                Ngưỡng đạt: <b>{s.config.pass_mark}/10</b>
              </p>
              <div className="mode">Kiểm tra</div>
            </>
          )}
        </section>
      </div>
      {s.question && (
        <section className="card current-question">
          <div className="row spread">
            <span className="badge">
              Câu {s.question.question_order}/{s.config.count} ·{" "}
              {stateLabel[s.question.status]}
            </span>
            <strong className="countdown">{time}s</strong>
          </div>
          <h2>{s.question.question}</h2>
          <div className="answer-grid">
            {["A", "B", "C", "D"].map((c) => (
              <div key={c}>
                <b>{c}</b> {s.question[`option_${c.toLowerCase()}`]}
              </div>
            ))}
          </div>
          <p>
            {s.answered}/{s.participants} học sinh đã trả lời
          </p>
        </section>
      )}
      <details className="card">
        <summary>Nhật ký kết nối và thao tác</summary>
        {s.events?.map((e: Data) => {
          const detail = JSON.parse(e.detail);
          return (
            <div className="event" key={e.id}>
              <time>{new Date(e.created_at).toLocaleTimeString("vi-VN")}</time>
              <span>
                {eventLabel[e.type] || "Sự kiện buổi kiểm tra"}{" "}
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
            <button className="danger" onClick={() => command("cancel")}>
              Hủy buổi
            </button>
            <button
              onClick={() =>
                void run(
                  () => api(`/sessions/${id}/presentation-access`, "DELETE"),
                  "Đã đóng quyền trình chiếu.",
                )
              }
            >
              Thu hồi màn hình chiếu
            </button>
          </>
        )}
        <a href={`/reports/${id}`}>Xem dữ liệu báo cáo →</a>
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
            throw Error("Quyền trình chiếu không đúng buổi");
          sessionStorage.setItem(`projection:${id}`, result.token);
          setGrant(result.token);
        })
        .catch((e) => setError(e.message));
    } else if (!grant)
      setError("Mở màn hình chiếu từ bảng điều khiển giáo viên.");
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
    time = useClock(s, live.offset);
  return (
    <main className="presentation">
      <header>
        <a href="#" onClick={(e) => e.preventDefault()} className="brand">
          <Icon name="book" />
          <span>
            Lớp học<small>TƯƠNG TÁC</small>
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
          Toàn màn hình
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
        <Status loading />
      ) : s.state === "LOBBY" ? (
        <div className="projection-wait">
          <p className="eyebrow">SẴN SÀNG CHO GIỜ HỌC</p>
          <h1>{s.name}</h1>
          <p>Quan sát màn hình. Chọn A, B, C hoặc D trên thiết bị.</p>
          <strong>Mã phòng {s.room_code}</strong>
        </div>
      ) : s.question ? (
        <>
          <div className="row spread">
            <p className="eyebrow">
              CÂU {s.question.question_order} / {s.config.count} ·{" "}
              {stateLabel[s.question.status]}
            </p>
            <span className="project-timer">
              {s.state === "PAUSED" ? "Tạm dừng · " : ""}
              {time}s
            </span>
          </div>
          <h1 className="project-question">{s.question.question}</h1>
          <div className="project-options">
            {["A", "B", "C", "D"].map((c) => (
              <div key={c}>
                <b>{c}</b>
                <span>{s.question[`option_${c.toLowerCase()}`]}</span>
              </div>
            ))}
          </div>
          <footer>
            {s.answered}/{s.participants} học sinh đã trả lời
            {["FINISHED", "CANCELLED"].includes(s.state) &&
              " · Buổi đã kết thúc"}
          </footer>
        </>
      ) : (
        <h1>{stateLabel[s.state]}</h1>
      )}
    </main>
  );
}
