import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, fields, stateLabel, type Data } from "../api";
import {
  Empty,
  Field,
  Head,
  Icon,
  Status,
  useApp,
  useResource,
} from "../components";
import { socketUrl } from "../socket";
import { questionSchema, flashcardSchema } from "../../../shared/protocol";
import { studentCodeSchema, STUDENT_CODE_ERROR } from "../../../shared/student-code";
import "./class-management.css";
import { ConfigFields, readConfig } from "../quiz-config";
import { t, locale, tc } from "../i18n";
export { ConfigFields, readConfig } from "../quiz-config";
export function Dashboard() {
  const sessions = useResource<Data[]>("/sessions"),
    classes = useResource<Data[]>("/classes"),
    banks = useResource<Data[]>("/question-banks");
  return (
    <>
      <Head
        eyebrow={t("KHÔNG GIAN DẠY HỌC")}
        title={t("Một giờ học. Nhiều kết nối.")}
        description={t("Chuẩn bị bài, lắng nghe lớp học và theo dõi từng câu trả lời.")}
      >
        <a className="button primary" href="/sessions/new">
          
          {t("+ Tạo buổi kiểm tra")}
        </a>
      </Head>
      <div className="hero welcome">
        <div>
          <p className="eyebrow">{t("HỌC CÙNG NHAU · TIẾN XA HƠN")}</p>
          <h2>{t("Sẵn sàng cho giờ học.")}</h2>
          <p>{t("Bắt đầu từ lớp học và bộ câu hỏi của thầy cô.")}</p>
          <a className="button primary" href="/classes">
            
            {t("Quản lý lớp học →")}
          </a>
        </div>
        <Icon name="book" />
      </div>
      <div className="stat-grid">
        {[
          [classes, t("Lớp học")],
          [banks, t("Bộ câu hỏi")],
          [sessions, t("Buổi kiểm tra")],
        ].map(([r, label]) => (
          <div className="card stat" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{(r as typeof classes).data?.length ?? "—"}</strong>
          </div>
        ))}
      </div>
      <section className="card dashboard-recent">
        <h2>{t("Buổi kiểm tra gần đây")}</h2>
        <Status error={sessions.error} loading={!sessions.data} />
        {sessions.data?.length === 0 && (
          <Empty>{t("Chưa có buổi kiểm tra. Tạo lớp và bộ đề để bắt đầu.")}</Empty>
        )}
        <div className="list">
          {sessions.data?.slice(0, 10).map((s) => (
            <a
              className="list-item"
              key={s.id}
              href={
                ["FINISHED", "CANCELLED"].includes(s.state)
                  ? `/reports/${s.id}`
                  : `/sessions/${s.id}`
              }
            >
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.class_name} ·{" "}
                  {new Date(s.created_at).toLocaleDateString(locale())}
                </small>
              </div>
              <span className="badge">{stateLabel[s.state]}</span>
              <span>→</span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
export function Importer({
  kind,
  onCommit,
  customUpload = false,
}: {
  kind: "questions" | "students" | "flashcards";
  onCommit: (rows: Data[]) => Promise<void>;
  customUpload?: boolean;
}) {
  const { run } = useApp(),
    [preview, setPreview] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [fileName, setFileName] = useState(""),
    [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  function inspectFile(file?: File) {
    if (!file || busy) return;
    if (customUpload) {
      setFileName(file.name);
      setPreview(null);
    }
    setBusy(true);
    void run(async () => {
      if (file.size > 5242880) throw Error(t("File vượt quá 5 MB"));
      setPreview(await api(`/imports/${kind}/preview`, "POST", file));
    }).finally(() => setBusy(false));
  }
  const columns =
    kind === "students"
      ? ["student_code", "full_name"]
      : kind === "flashcards"
        ? ["front", "back"]
        : [
          "question",
          "option_a",
          "option_b",
          "option_c",
          "option_d",
          "correct_answer",
          "explanation",
          "topic",
          "difficulty",
        ];
  const edit = (i: number, k: string, v: string) =>
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r: Data, j: number) =>
              j === i ? { ...r, [k]: v } : r,
            ),
          }
        : p,
    );
  const localErrors =
    preview?.rows.flatMap((r: Data, i: number) => {
      if (kind === "students") {
        const errors = [];
        if (!studentCodeSchema.safeParse(r.student_code).success)
          errors.push(t("Dòng {v}: {STUDENT_CODE_ERROR}", { v: i + 2, STUDENT_CODE_ERROR: t(STUDENT_CODE_ERROR) }));
        if (!r.full_name.trim()) errors.push(t("Dòng {v}: cần họ tên", { v: i + 2 }));
        return errors;
      }
      const parsed = (
        kind === "flashcards" ? flashcardSchema : questionSchema
      ).safeParse(r);
      return parsed.success
        ? []
        : parsed.error.issues.map(
            (e) => t("Dòng {v} · {v2}: {message}", { v: i + 2, v2: e.path.join("."), message: e.message }),
          );
    }) ?? [];
  function downloadErrors() {
    const blob = new Blob(
        [
          JSON.stringify(
            { errors: preview?.errors, rows: preview?.rows },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "loi-nhap-file.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="importer">
      <div className="row spread">
        <div>
          <h3>
            
            {t("Nhập")}{" "}
            {kind === "questions"
              ? t("câu hỏi")
              : kind === "flashcards"
                ? t("thẻ (cột front = mặt trước, back = mặt sau)")
                : t("danh sách học sinh")}
          </h3>
          <p className="muted">{t("XLSX hoặc CSV · Tối đa 5 MB, 500 dòng")}{kind === "students" && t(" · MSSV: 1–10 chữ số; cột Excel phải là Text để giữ số 0 đầu.")}</p>
          {kind === "flashcards" && (
            <div className="fc-format">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>A</th>
                    <th>B</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>1</th>
                    <td>front</td>
                    <td>back</td>
                  </tr>
                  <tr>
                    <th>2</th>
                    <td>{t("GPIO9 trên ESP32-C3 dùng để làm gì?")}</td>
                    <td>{t("Chân strapping, kéo xuống GND để nạp firmware")}</td>
                  </tr>
                </tbody>
              </table>
              <ul>
                <li>{t("Dòng 1 là tiêu đề:")} <b>front</b>  {t("và")} <b>back</b>  {t("(hoặc \"Mặt trước\" và \"Mặt sau\"). Mỗi dòng sau là một thẻ.")}</li>
                <li>{t("Excel: lấy sheet đầu tiên. Xuống dòng trong ô (Alt+Enter) được giữ nguyên.")}</li>
                <li>{t("CSV: lưu dạng \"CSV UTF-8\", dấu phân cách")} <b>,</b>  {t("hoặc")} <b>;</b>  {t("đều được.")}</li>
              </ul>
            </div>
          )}
        </div>
        <div className="actions">
          <a href={`/api/templates/${kind}.xlsx`}>{t("Mẫu Excel ↓")}</a>
          <a href={`/api/templates/${kind}.csv`}>{t("Mẫu CSV ↓")}</a>
        </div>
      </div>
      {customUpload ? (
        <div className="class-upload">
          <label
            aria-busy={busy}
            className={`class-upload-area${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
            onDragEnter={(e) => {
              if (busy || !e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current++;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = busy ? "none" : "copy";
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              inspectFile(e.dataTransfer.files[0]);
            }}
          >
            <input
              className="class-upload-input"
              type="file"
              accept=".xlsx,.csv"
              aria-label={t("Chọn file Excel hoặc CSV để xem trước danh sách học sinh")}
              disabled={busy}
              onChange={(e) => {
                inspectFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <span className="class-upload-icon">
              <Icon name="upload" />
            </span>
            <strong>
              {dragging ? t("Thả file để xem trước") : t("Kéo thả file hoặc nhấn để chọn")}
            </strong>
            <span>{t("Hỗ trợ XLSX, CSV · Tối đa 5MB")}</span>
          </label>
          {fileName && (
            <div className="class-upload-file" role="status">
              <Icon name="file" />
              <span>{fileName}</span>
            </div>
          )}
        </div>
      ) : (
        <Field label={t("Chọn file để xem trước")}>
          <input
            type="file"
            accept=".xlsx,.csv"
            disabled={busy}
            onChange={(e) => inspectFile(e.target.files?.[0])}
          />
        </Field>
      )}
      {busy && <p role="status">{t("Đang đọc file…")}</p>}
      {preview && (
        <>
          <div className="row spread">
            <h3>{t("Duyệt")} {preview.rows.length}  {t("dòng trước khi lưu")}</h3>
            <button onClick={downloadErrors}>{t("Tải nội dung và lỗi")}</button>
          </div>
          {preview.errors.length > 0 && (
            <div className="alert">
              <strong>
                
                {t("File có lỗi. Sửa trực tiếp bên dưới trước khi lưu.")}
              </strong>
              {preview.errors.map((e: Data, i: number) => (
                <div key={i}>
                  
                  {t("Dòng")} {e.row} · {e.column}: {e.message}
                </div>
              ))}
            </div>
          )}
          {preview.warnings.map((e: Data, i: number) => (
            <p className="warning" key={i}>
              
              {t("Dòng")} {e.row}: {e.message}
            </p>
          ))}
          <div className="table-scroll preview-table">
            <table>
              <thead>
                <tr>
                  <th>{t("Dòng")}</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r: Data, i: number) => (
                  <tr key={i}>
                    <td>{i + 2}</td>
                    {columns.map((c) => (
                      <td key={c}>
                        <input
                          aria-label={t("Dòng {v} {c}", { v: i + 2, c })}
                          value={r[c] ?? ""}
                          onChange={(e) => edit(i, c, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {localErrors.length > 0 && (
            <p className="alert">{localErrors.slice(0, 5).join(" · ")}</p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={!!localErrors.length || busy || !preview.rows.length}
              onClick={() => {
                setBusy(true);
                void run(async () => {
                  const rows = kind === "students"
                    ? preview.rows.map((row: Data) => ({ ...row, student_code: studentCodeSchema.parse(row.student_code) }))
                    : preview.rows;
                  await onCommit(rows);
                  setPreview(null);
                }, t("Đã lưu toàn bộ dữ liệu.")).finally(() => setBusy(false));
              }}
            >
              
              {t("Xác nhận và lưu")} {preview.rows.length}  {tc(preview.rows.length, "dòng")}
            </button>
            <button onClick={() => setPreview(null)}>{t("Bỏ bản xem trước")}</button>
          </div>
        </>
      )}
    </section>
  );
}
export function Classes({ id }: { id?: string }) {
  const resource = useResource<Data>(id ? `/classes/${id}` : "/classes"),
    devices = useResource<Data[]>("/devices"),
    { run } = useApp(),
    [editing, setEditing] = useState<Data | null>(null),
    [deleting, setDeleting] = useState(false),
    [search, setSearch] = useState("");
  const studentCodeInput = useRef<HTMLInputElement>(null);
  const focusStudentForm = () => {
    setEditing(null);
    requestAnimationFrame(() => {
      studentCodeInput.current?.focus({ preventScroll: true });
      studentCodeInput.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "nearest",
      });
    });
  };
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data;
  const visibleStudents: Data[] = id
    ? d.students.filter((s: Data) =>
        (s.full_name + s.student_code).toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  return (
    <>
      <Head
        eyebrow={t("LỚP HỌC")}
        title={id ? d.name : t("Kết nối bắt đầu từ lớp học.")}
        description={
          id
            ? t("{length} học sinh · Mã học sinh là duy nhất trong lớp", { length: d.students.length })
            : t("Quản lý danh sách để chuẩn bị cho mỗi buổi kiểm tra.")
        }
      >
        {id && (
          <>
            <button
              onClick={() =>
                void run(async () => {
                  const a = await api("/attendance", "POST", { class_id: id });
                  window.location.href = `/attendance/${a.id}`;
                })
              }
            >
              <Icon name="users" />  {t("Điểm danh")}
            </button>
            <a className="button primary" href={`/sessions/new?class=${id}`}>
              
              {t("Tạo buổi kiểm tra →")}
            </a>
          </>
        )}
      </Head>
      <Status error={resource.error} />
      {!id ? (
        <div className="two-col">
          <section className="card">
            <h2>{t("Các lớp của thầy cô")}</h2>
            {!d.length && (
              <Empty>{t("Chưa có lớp. Tạo lớp đầu tiên ở bên cạnh.")}</Empty>
            )}
            <div className="list">
              {(d as unknown as Data[]).map((c) => (
                <a className="list-item" key={c.id} href={`/classes/${c.id}`}>
                  <span className="avatar">
                    <Icon name="users" />
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.student_count}  {tc(c.student_count, "học sinh")}
                      {c.archived ? t(" · Đã lưu trữ") : ""}
                    </small>
                  </div>
                  <span>→</span>
                </a>
              ))}
            </div>
          </section>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = fields(e.currentTarget);
              void run(async () => {
                const result = await api("/classes", "POST", body);
                window.location.href = `/classes/${result.id}`;
              });
            }}
          >
            <h2>{t("Tạo lớp mới")}</h2>
            <Field label={t("Tên lớp")}>
              <input
                name="name"
                placeholder={t("Ví dụ: Lớp 8A")}
                maxLength={150}
                required
              />
            </Field>
            <button className="primary">{t("Tạo lớp")}</button>
          </form>
        </div>
      ) : (
        <div className="class-detail">
          <div className="class-management-grid">
            <section
              className="card class-roster-card"
              aria-labelledby="class-roster-heading"
            >
              <div className="class-roster-header">
                <h2 id="class-roster-heading">
                  <Icon name="users" />  {t("Danh sách học sinh")}
                </h2>
                <span className="badge">{d.students.length}  {tc(d.students.length, "học sinh")}</span>
              </div>
              <label className="class-roster-search">
                <span>{t("Tìm học sinh")}</span>
                <span className="class-search-input">
                  <Icon name="search" />
                  <input
                    type="search"
                    placeholder={t("Tìm theo mã hoặc họ tên…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </span>
              </label>
              <div className="class-roster-content">
                {!visibleStudents.length ? (
                  <div className="class-empty-state" role="status">
                    <span className="class-empty-icon">
                      <Icon name={d.students.length ? "search" : "users"} />
                    </span>
                    <h3>
                      {d.students.length
                        ? t("Không tìm thấy học sinh phù hợp")
                        : t("Chưa có học sinh nào")}
                    </h3>
                    <p>{d.students.length
                      ? t("Thử tìm bằng mã học sinh hoặc họ tên khác.")
                      : t("Thêm học sinh mới hoặc nhập danh sách từ Excel/CSV để bắt đầu quản lý lớp.")}</p>
                    {!d.students.length && (
                      <button type="button" className="primary" onClick={focusStudentForm}>
                        <Icon name="plus" />  {t("Thêm học sinh")}
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className="table-scroll class-roster-table"
                    tabIndex={0}
                    role="region"
                    aria-label={t("Bảng danh sách học sinh")}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Mã học sinh")}</th>
                          <th>{t("Họ tên")}</th>
                          <th>{t("Thiết bị mặc định")}</th>
                          <th>{t("Thao tác")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleStudents.map((s) => (
                          <tr key={s.id}>
                            <td>{s.student_code}</td>
                            <td>{s.full_name}</td>
                            <td>
                              <select
                                aria-label={t("Thiết bị mặc định của {full_name}", { full_name: s.full_name })}
                                value={s.device_id ?? ""}
                                onChange={(e) =>
                                  void run(async () => {
                                    await api(
                                      `/classes/${id}/students/${s.id}/device`,
                                      "PUT",
                                      { device_id: e.target.value || null },
                                    );
                                    resource.reload();
                                  })
                                }
                              >
                                <option value="">{t("— Chưa gán —")}</option>
                                {s.device_id && s.device_revoked ? (
                                  <option value={s.device_id}>
                                    {s.device_label}  {t("(đã thu hồi)")}
                                  </option>
                                ) : null}
                                {devices.data
                                  ?.filter((dv) => !dv.revoked)
                                  .map((dv) => (
                                    <option key={dv.id} value={dv.id}>
                                      {dv.label}
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setEditing(s)}
                              >
                                
                                {t("Sửa")}
                              </button>
                              <button
                                className="text-button danger"
                                onClick={() => {
                                  if (
                                    confirm(
                                      t("Xóa {full_name} khỏi danh sách lớp? Kết quả cũ vẫn được giữ.", { full_name: s.full_name }),
                                    )
                                  )
                                    void run(async () => {
                                      await api(
                                        `/classes/${id}/students/${s.id}`,
                                        "DELETE",
                                      );
                                      resource.reload();
                                    });
                                }}
                              >
                                
                                {t("Xóa")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {d.students.length > 0 && (
                <p className="muted class-device-hint">
                  
                  {t("Thiết bị mặc định dùng cho điểm danh. Ghép thiết bị trong buổi kiểm tra không thay đổi mapping điểm danh này.")}
                </p>
              )}
            </section>
            <div className="class-management-side">
              <form
                className="card form class-student-form"
                key={editing?.id || "new"}
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = fields(e.currentTarget);
                  void run(async () => {
                    const parsed = studentCodeSchema.safeParse(body.student_code);
                    if (!parsed.success) throw Error(t(STUDENT_CODE_ERROR));
                    body.student_code = parsed.data;
                    if (editing)
                      await api(
                        `/classes/${id}/students/${editing.id}`,
                        "PATCH",
                        body,
                      );
                    else
                      await api(`/classes/${id}/students/import`, "POST", {
                        rows: [body],
                      });
                    setEditing(null);
                    resource.reload();
                  }, t("Đã lưu học sinh."));
                }}
              >
                <h2>
                  <Icon name={editing ? "users" : "plus"} />
                  {editing ? t("Sửa học sinh") : t("Thêm học sinh")}
                </h2>
                <Field label={t("Mã học sinh")}>
                  <input
                    ref={studentCodeInput}
                    name="student_code"
                    defaultValue={editing?.student_code}
                    required
                    inputMode="numeric"
                  />
                </Field>
                <Field label={t("Họ tên")}>
                  <input
                    name="full_name"
                    defaultValue={editing?.full_name}
                    required
                    maxLength={150}
                  />
                </Field>
                <button className="primary">
                  <Icon name={editing ? "check" : "plus"} />  {t("Lưu học sinh")}
                </button>
                {editing && (
                  <button type="button" onClick={() => setEditing(null)}>
                    
                    {t("Hủy sửa")}
                  </button>
                )}
              </form>
              <form
                className="card form class-settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = fields(e.currentTarget);
                  void run(async () => {
                    await api(`/classes/${id}`, "PATCH", {
                      name: body.name,
                      archived: body.archived === "on",
                    });
                    resource.reload();
                  }, t("Đã lưu lớp."));
                }}
              >
                <h2>
                  <Icon name="settings" />  {t("Cài đặt lớp")}
                </h2>
                <Field label={t("Tên lớp")}>
                  <input name="name" defaultValue={d.name} required />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    name="archived"
                    defaultChecked={!!d.archived}
                  />{" "}
                  
                  {t("Lưu trữ lớp")}
                </label>
                <div className="class-settings-actions">
                  <button className="primary">{t("Lưu cài đặt")}</button>
                  <button
                    type="button"
                    className="danger"
                    disabled={deleting}
                    onClick={() => {
                      if (!window.confirm(
                        t("Xóa lớp “{name}” và {length} học sinh? Các gán thiết bị sẽ được gỡ. Thao tác này không thể hoàn tác. Lớp có lịch sử kiểm tra hoặc điểm danh chỉ có thể lưu trữ.", { name: d.name, length: d.students.length }),
                      )) return;
                      setDeleting(true);
                      void run(async () => {
                        await api(`/classes/${id}`, "DELETE");
                        window.location.href = "/classes";
                      }).finally(() => setDeleting(false));
                    }}
                  >
                    {deleting ? t("Đang xóa lớp…") : t("Xóa lớp")}
                  </button>
                </div>
              </form>
            </div>
          </div>
          <section className="card class-import-card">
            <Importer
              kind="students"
              customUpload
              onCommit={async (rows) => {
                await api(`/classes/${id}/students/import`, "POST", { rows });
                resource.reload();
              }}
            />
          </section>
          <section className="card">
            <h2>{t("Lịch sử buổi kiểm tra")}</h2>
            {d.sessions.map((s: Data) => (
              <a className="list-item" key={s.id} href={`/sessions/${s.id}`}>
                <strong>{s.name}</strong>
                <span>{stateLabel[s.state]}</span>
              </a>
            ))}
            {!d.sessions.length && <Empty>{t("Lớp chưa có buổi kiểm tra.")}</Empty>}
          </section>
        </div>
      )}
    </>
  );
}
export function Devices() {
  const r = useResource<Data[]>("/devices"),
    { run, user } = useApp(),
    [selectedDevice, setSelectedDevice] = useState(""),
    [credentials, setCredentials] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState<"active" | "offline" | "revoked">("active");
  const { setData } = r;
  useEffect(() => {
    let live = true;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      api<Data[]>("/devices").then((devices) => {
        if (live) setData(devices);
      }).catch(() => {});
    }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [setData]);
  const visible = r.data?.filter((d) =>
    filter === "revoked"
      ? d.revoked
      : filter === "offline"
        ? !d.revoked && !d.online
        : !d.revoked,
  );
  return (
    <>
      <Head
        eyebrow={t("THIẾT BỊ")}
        title={t("Mỗi học sinh, một kết nối.")}
        description={t("Đăng ký, cấp lại thông tin và theo dõi thiết bị thuộc tài khoản.")}
      >
        {user.simulator && (
          <a className="button" href="/simulator">
            
            {t("Mở giả lập ↗")}
          </a>
        )}
      </Head>
      <div className="two-col">
        <section className="card">
          <h2>{t("Thiết bị đã đăng ký")}</h2>
          <div className="device-tabs" role="group" aria-label={t("Lọc thiết bị")}>
            {(["active", "offline", "revoked"] as const).map((key) => (
              <button key={key} className={filter === key ? "selected" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {{active:t("Đang dùng"),offline:t("Chưa kết nối"),revoked:t("Đã thu hồi")}[key]}
              </button>
            ))}
          </div>
          <Status loading={!r.data} error={r.error} />
          {visible?.map((d) => (
            <article className="device-entry" key={d.id}>
              <div className="list-item">
                <Icon name="device" />
                <div>
                  <strong>{d.label}</strong>
                  <small>
                    {d.assigned_session ? t("Đã ghép vào phòng · ") : ""}
                    {d.revoked
                      ? t("Đã thu hồi")
                      : d.online
                        ? t("Đang kết nối")
                        : t("Chưa kết nối")}
                    {d.last_seen
                      ? ` · ${new Date(d.last_seen).toLocaleString(locale())}`
                      : ""}
                  </small>
                </div>
                <div className="actions">
                  <button
                    className="device-id-button"
                    aria-expanded={selectedDevice === d.id}
                    aria-controls={`device-connection-${d.id}`}
                    onClick={() =>
                      setSelectedDevice((current) => current === d.id ? "" : d.id)
                    }
                  >
                    Device ID: {d.id.slice(-6)}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          t("Cấp secret mới sẽ ngắt kết nối hiện tại. Tiếp tục?"),
                        )
                      )
                        void run(async () => {
                          const credential = await api(
                            `/devices/${d.id}/rotate-secret`,
                            "POST",
                          );
                          setCredentials((current) => ({
                            ...current,
                            [d.id]: credential.secret,
                          }));
                          setSelectedDevice(d.id);
                          r.reload();
                        });
                    }}
                  >
                    {d.revoked ? t("Kích hoạt lại") : t("Cấp lại")}
                  </button>
                  <button
                    disabled={!!d.revoked}
                    onClick={() => {
                      if (confirm(t("Thu hồi thiết bị {label}?", { label: d.label })))
                        void run(async () => {
                          await api(`/devices/${d.id}/revoke`, "POST");
                          setCredentials((current) => {
                            const next = { ...current };
                            delete next[d.id];
                            return next;
                          });
                          r.reload();
                        });
                    }}
                  >
                    
                    {t("Thu hồi")}
                  </button>
                  {!d.used && <button onClick={() => {
                    if (confirm(t("Xóa vĩnh viễn thiết bị {label}?", { label: d.label }))) void run(async () => {
                      await api(`/devices/${d.id}`, "DELETE");
                      if (selectedDevice === d.id) setSelectedDevice("");
                      setCredentials((current) => {
                        const next = { ...current };
                        delete next[d.id];
                        return next;
                      });
                      r.reload();
                    }, t("Đã xóa thiết bị chưa từng dùng."));
                  }}>{t("Xóa")}</button>}
                </div>
              </div>
              {selectedDevice === d.id && (
                <section
                  className="device-connection"
                  id={`device-connection-${d.id}`}
                  aria-label={t("Thông tin kết nối {label}", { label: d.label })}
                >
                  <div className="row spread">
                    <div>
                      <h3>{t("Thông tin kết nối ·")} {d.label}</h3>
                      <small>{t("ESP32 dùng các giá trị này để mở WebSocket.")}</small>
                    </div>
                    <button onClick={() => setSelectedDevice("")}>{t("Đóng")}</button>
                  </div>
                  <div className="connection-values">
                    <Field label="WebSocket URL">
                      <input readOnly value={socketUrl()} />
                    </Field>
                    <Field label="Device ID">
                      <input readOnly value={d.id} />
                    </Field>
                    {credentials[d.id] ? (
                      <Field label={t("Secret — chỉ hiển thị trong lần này")}>
                        <input readOnly value={credentials[d.id]} />
                      </Field>
                    ) : (
                      <p className="device-secret-note">
                        
                        {t("Secret cũ không thể xem lại vì máy chủ chỉ lưu bản băm. Bấm")} <b>{t("Cấp lại")}</b>  {t("nếu cần tạo secret mới.")}
                      </p>
                    )}
                  </div>
                  <p className="device-header-hint">
                    Header firmware: <code>Authorization: Bearer &lt;secret&gt;</code>
                    {" · "}<code>X-Device-Id: {d.id}</code>
                  </p>
                </section>
              )}
            </article>
          ))}
          {visible?.length === 0 && (
            <Empty>{filter === "revoked" ? t("Chưa có thiết bị đã thu hồi.") : t("Không có thiết bị trong bộ lọc này. Đăng ký hoặc chọn bộ lọc khác.")}</Empty>
          )}
          <button onClick={r.reload}>{t("Cập nhật trạng thái")}</button>
        </section>
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              body = fields(form);
            void run(async () => {
              const credential = await api("/devices", "POST", body);
              setCredentials((current) => ({
                ...current,
                [credential.id]: credential.secret,
              }));
              setSelectedDevice(credential.id);
              form.reset();
              r.reload();
            }, t("Đã đăng ký thiết bị."));
          }}
        >
          <h2>{t("Đăng ký thiết bị")}</h2>
          <Field label={t("Nhãn thiết bị")}>
            <input name="label" placeholder="ESP-01" required maxLength={150} />
          </Field>
          <button className="primary">{t("Đăng ký")}</button>
        </form>
      </div>
    </>
  );
}
export function Setup() {
  const classes = useResource<Data[]>("/classes"),
    banks = useResource<Data[]>("/question-banks"),
    { run } = useApp();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fields(e.currentTarget);
    void run(async () => {
      const s = await api("/sessions", "POST", {
        name: f.name,
        class_id: f.class_id,
        bank_id: f.bank_id,
        config: readConfig(f),
      });
      window.location.href = `/sessions/${s.id}`;
    });
  }
  return (
    <>
      <Head
        eyebrow={t("BUỔI KIỂM TRA MỚI")}
        title={t("Chuẩn bị một giờ học mới.")}
        description={t("Chọn lớp, bộ đề và cách tổ chức bài kiểm tra.")}
      />
      <Status error={classes.error || banks.error} />
      <ol className="setup-steps" aria-label={t("Các bước chuẩn bị bài")}>
        <li className="selected">{t("1. Lớp và bộ đề")}</li><li className="selected">{t("2. Cấu hình")}</li><li>{t("3. Ghép thiết bị")}</li><li>{t("4. Sẵn sàng")}</li>
      </ol>
      <form className="card form setup" onSubmit={submit}>
        <Field label={t("Tên buổi kiểm tra")}>
          <input
            name="name"
            placeholder={t("Ôn tập chương I")}
            required
            maxLength={150}
          />
        </Field>
        <div className="form-grid">
          <Field label={t("Lớp học")}>
            <select
              name="class_id"
              key={classes.data ? "loaded" : "loading"}
              defaultValue={
                new URLSearchParams(location.search).get("class") || ""
              }
              required
            >
              <option value="">{t("Chọn lớp")}</option>
              {classes.data
                ?.filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.student_count}  {tc(c.student_count, "học sinh")}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t("Bộ đề")}>
            <select
              name="bank_id"
              key={banks.data ? "loaded" : "loading"}
              defaultValue={new URLSearchParams(location.search).get("bank") || ""}
              required
            >
              <option value="">{t("Chọn bộ đề")}</option>
              {banks.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.question_count}  {tc(b.question_count, "câu")}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ConfigFields />
        <div className="actions">
          <button className="primary">{t("Tạo phòng chờ →")}</button>
          <a href="/dashboard">{t("Quay lại")}</a>
        </div>
      </form>
      {classes.data?.length === 0 && (
        <p className="alert">
          
          {t("Cần")} <a href="/classes">{t("tạo lớp và học sinh")}</a>  {t("trước.")}
        </p>
      )}
      {banks.data?.length === 0 && (
        <p className="alert">
          
          {t("Cần")} <a href="/question-banks">{t("tạo bộ đề và nhập câu hỏi")}</a>  {t("trước.")}
        </p>
      )}
    </>
  );
}
