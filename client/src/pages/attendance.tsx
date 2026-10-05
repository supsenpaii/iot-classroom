import { useRef, useState } from "react";
import { api, type Data } from "../api";
import { Empty, Head, Icon, Status, useApp, useResource } from "../components";
import { useActivitySocket } from "../socket";

const clock = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";

export function AttendancePage({ id }: { id?: string }) {
  return id ? <AttendanceLive id={id} /> : <AttendanceHome />;
}

function AttendanceHome() {
  const classes = useResource<Data[]>("/classes"),
    list = useResource<Data[]>("/attendance"),
    { run } = useApp();
  return (
    <>
      <Head
        eyebrow="ĐIỂM DANH"
        title="Có mặt chỉ bằng một lần bấm."
        description="Mở điểm danh cho lớp, học sinh bấm phím bất kỳ trên thiết bị đã gán. Xuất danh sách ra Excel."
      />
      <div className="two-col">
        <section className="card">
          <h2>Các buổi điểm danh</h2>
          <Status error={list.error} loading={!list.data} />
          {list.data?.map((a) => (
            <a className="list-item" key={a.id} href={`/attendance/${a.id}`}>
              <Icon name="users" />
              <div>
                <strong>{a.class_name}</strong>
                <small>
                  {new Date(a.created_at).toLocaleString("vi-VN")} · có mặt {a.present}/{a.total}
                </small>
              </div>
              <span className="badge">{a.state === "OPEN" ? "Đang mở" : "Đã đóng"}</span>
              <span>→</span>
            </a>
          ))}
          {list.data?.length === 0 && <Empty>Chưa có buổi điểm danh nào.</Empty>}
        </section>
        <section className="card">
          <h2>Bắt đầu điểm danh</h2>
          <p className="muted">
            Học sinh cần được gán thiết bị mặc định ở trang Lớp học. Em chưa gán thiết bị vẫn điểm
            danh tay được.
          </p>
          <Status error={classes.error} loading={!classes.data} />
          {classes.data
            ?.filter((c) => !c.archived)
            .map((c) => (
              <div className="list-item" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.student_count} học sinh</small>
                </div>
                <button
                  className="primary"
                  disabled={!c.student_count}
                  onClick={() =>
                    void run(async () => {
                      const a = await api("/attendance", "POST", { class_id: c.id });
                      window.location.href = `/attendance/${a.id}`;
                    })
                  }
                >
                  Mở điểm danh
                </button>
              </div>
            ))}
          {classes.data?.length === 0 && <Empty>Chưa có lớp nào.</Empty>}
        </section>
      </div>
    </>
  );
}

function AttendanceLive({ id }: { id: string }) {
  const { run } = useApp(),
    { data, status, setData } = useActivitySocket("attendance_id", "attendance", id),
    [busy, setBusy] = useState(false),
    stage = useRef<HTMLDivElement>(null);
  const command = (body: Data) => {
    if (busy) return;
    setBusy(true);
    void run(async () => {
      const next = await api(`/attendance/${id}/commands`, "POST", body);
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
  const open = data.state === "OPEN",
    noDevice = data.students.filter((s: Data) => !s.device_label).length;
  return (
    <div className="attendance-live" ref={stage}>
      <header className="fc-review-head">
        <div>
          <p className="eyebrow">
            ĐIỂM DANH · {open ? "ĐANG MỞ" : "ĐÃ ĐÓNG"} · {new Date(data.created_at).toLocaleString("vi-VN")}
          </p>
          <h1>{data.class_name}</h1>
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
          <a className="button" href={`/api/attendance/${id}/export.xlsx`}>
            Xuất Excel ↓
          </a>
          {open && (
            <button className="danger" disabled={busy} onClick={() => command({ action: "close" })}>
              Đóng điểm danh
            </button>
          )}
        </div>
      </header>
      <div className="attendance-summary">
        <div className="attendance-count">
          <strong>{data.present}</strong>
          <span>/{data.total} có mặt</span>
        </div>
        <div className="fc-progress-track" aria-hidden="true">
          <span style={{ width: `${(data.present / Math.max(1, data.total)) * 100}%` }} />
        </div>
        <p className="muted">
          {open
            ? "Học sinh bấm phím bất kỳ trên thiết bị của mình. Bấm vào ô để sửa tay."
            : "Đã đóng. Vẫn có thể bấm vào ô để sửa trước khi xuất Excel."}
          {" "}{status !== "Đã kết nối" && `(${status})`}
        </p>
      </div>
      {noDevice > 0 && (
        <p className="warning">
          {noDevice} học sinh chưa gán thiết bị nên không tự điểm danh được.{" "}
          <a href={`/classes/${data.class_id}`}>Gán thiết bị ở trang lớp →</a>
        </p>
      )}
      <div className="attendance-grid">
        {data.students.map((s: Data) => {
          const present = s.status === "PRESENT";
          return (
            <button
              key={s.student_id}
              className={`attendance-tile${present ? " is-present" : ""}`}
              disabled={busy}
              onClick={() =>
                command({
                  action: "mark",
                  student_id: s.student_id,
                  status: present ? "ABSENT" : "PRESENT",
                })
              }
              aria-label={`${s.full_name}: ${present ? "có mặt" : "chưa điểm danh"}. Bấm để đổi.`}
            >
              <span className="attendance-name">{s.full_name}</span>
              <small>
                {s.student_code} · {s.device_label ?? "chưa gán thiết bị"}
                {s.device_label && <i className={`dot${s.online ? "" : " amber"}`} aria-hidden="true" />}
              </small>
              <span className="attendance-status">
                {present
                  ? `Có mặt ${clock(s.marked_at)}${s.method === "MANUAL" ? " · ghi tay" : ""}`
                  : "Chưa điểm danh"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
