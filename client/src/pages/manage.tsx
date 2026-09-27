import { useState, type FormEvent } from "react";
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
import { questionSchema } from "../../../shared/protocol";
export function Dashboard() {
  const sessions = useResource<Data[]>("/sessions"),
    classes = useResource<Data[]>("/classes"),
    banks = useResource<Data[]>("/question-banks");
  return (
    <>
      <Head
        eyebrow="KHÔNG GIAN DẠY HỌC"
        title="Một giờ học. Nhiều kết nối."
        description="Chuẩn bị bài, lắng nghe lớp học và theo dõi từng câu trả lời."
      >
        <a className="button primary" href="/sessions/new">
          + Tạo buổi kiểm tra
        </a>
      </Head>
      <div className="hero welcome">
        <div>
          <p className="eyebrow">HỌC CÙNG NHAU · TIẾN XA HƠN</p>
          <h2>Sẵn sàng cho giờ học.</h2>
          <p>Bắt đầu từ lớp học và bộ câu hỏi của thầy cô.</p>
          <a className="button primary" href="/classes">
            Quản lý lớp học →
          </a>
        </div>
        <Icon name="book" />
      </div>
      <div className="stat-grid">
        {[
          [classes, "Lớp học"],
          [banks, "Bộ câu hỏi"],
          [sessions, "Buổi kiểm tra"],
        ].map(([r, label]) => (
          <div className="card stat" key={String(label)}>
            <span>{String(label)}</span>
            <strong>{(r as typeof classes).data?.length ?? "—"}</strong>
          </div>
        ))}
      </div>
      <section className="card">
        <h2>Buổi kiểm tra gần đây</h2>
        <Status error={sessions.error} loading={!sessions.data} />
        {sessions.data?.length === 0 && (
          <Empty>Chưa có buổi kiểm tra. Tạo lớp và bộ đề để bắt đầu.</Empty>
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
                  {new Date(s.created_at).toLocaleDateString("vi-VN")}
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
}: {
  kind: "questions" | "students";
  onCommit: (rows: Data[]) => Promise<void>;
}) {
  const { run } = useApp(),
    [preview, setPreview] = useState<Data | null>(null),
    [busy, setBusy] = useState(false);
  const columns =
    kind === "students"
      ? ["student_code", "full_name"]
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
      if (kind === "students")
        return !r.student_code.trim() || !r.full_name.trim()
          ? [`Dòng ${i + 2}: cần mã và họ tên`]
          : [];
      const parsed = questionSchema.safeParse(r);
      return parsed.success
        ? []
        : parsed.error.issues.map(
            (e) => `Dòng ${i + 2} · ${e.path.join(".")}: ${e.message}`,
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
            Nhập {kind === "questions" ? "câu hỏi" : "danh sách học sinh"}
          </h3>
          <p className="muted">XLSX hoặc CSV · Tối đa 5 MB, 500 dòng</p>
        </div>
        <div className="actions">
          <a href={`/api/templates/${kind}.xlsx`}>Mẫu Excel ↓</a>
          <a href={`/api/templates/${kind}.csv`}>Mẫu CSV ↓</a>
        </div>
      </div>
      <Field label="Chọn file để xem trước">
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            void run(async () => {
              if (file.size > 5242880) throw Error("File vượt quá 5 MB");
              setPreview(await api(`/imports/${kind}/preview`, "POST", file));
            }).finally(() => setBusy(false));
          }}
        />
      </Field>
      {busy && <p role="status">Đang đọc file…</p>}
      {preview && (
        <>
          <div className="row spread">
            <h3>Duyệt {preview.rows.length} dòng trước khi lưu</h3>
            <button onClick={downloadErrors}>Tải nội dung và lỗi</button>
          </div>
          {preview.errors.length > 0 && (
            <div className="alert">
              <strong>
                File có lỗi. Sửa trực tiếp bên dưới trước khi lưu.
              </strong>
              {preview.errors.map((e: Data, i: number) => (
                <div key={i}>
                  Dòng {e.row} · {e.column}: {e.message}
                </div>
              ))}
            </div>
          )}
          {preview.warnings.map((e: Data, i: number) => (
            <p className="warning" key={i}>
              Dòng {e.row}: {e.message}
            </p>
          ))}
          <div className="table-scroll preview-table">
            <table>
              <thead>
                <tr>
                  <th>Dòng</th>
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
                          aria-label={`Dòng ${i + 2} ${c}`}
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
                  await onCommit(preview.rows);
                  setPreview(null);
                }, "Đã lưu toàn bộ dữ liệu.").finally(() => setBusy(false));
              }}
            >
              Xác nhận và lưu {preview.rows.length} dòng
            </button>
            <button onClick={() => setPreview(null)}>Bỏ bản xem trước</button>
          </div>
        </>
      )}
    </section>
  );
}
export function Classes({ id }: { id?: string }) {
  const resource = useResource<Data>(id ? `/classes/${id}` : "/classes"),
    { run } = useApp(),
    [editing, setEditing] = useState<Data | null>(null),
    [search, setSearch] = useState("");
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data;
  return (
    <>
      <Head
        eyebrow="LỚP HỌC"
        title={id ? d.name : "Kết nối bắt đầu từ lớp học."}
        description={
          id
            ? `${d.students.length} học sinh · Mã học sinh là duy nhất trong lớp`
            : "Quản lý danh sách để chuẩn bị cho mỗi buổi kiểm tra."
        }
      >
        {id && (
          <a className="button primary" href={`/sessions/new?class=${id}`}>
            Tạo buổi kiểm tra →
          </a>
        )}
      </Head>
      <Status error={resource.error} />
      {!id ? (
        <div className="two-col">
          <section className="card">
            <h2>Các lớp của thầy cô</h2>
            {!d.length && (
              <Empty>Chưa có lớp. Tạo lớp đầu tiên ở bên cạnh.</Empty>
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
                      {c.student_count} học sinh
                      {c.archived ? " · Đã lưu trữ" : ""}
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
            <h2>Tạo lớp mới</h2>
            <Field label="Tên lớp">
              <input
                name="name"
                placeholder="Ví dụ: Lớp 8A"
                maxLength={150}
                required
              />
            </Field>
            <button className="primary">Tạo lớp</button>
          </form>
        </div>
      ) : (
        <>
          <div className="two-col">
            <section className="card">
              <div className="row spread">
                <h2>Danh sách học sinh</h2>
                <input
                  aria-label="Tìm học sinh"
                  placeholder="Tìm học sinh…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Mã học sinh</th>
                      <th>Họ tên</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.students
                      .filter((s: Data) =>
                        (s.full_name + s.student_code)
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((s: Data) => (
                        <tr key={s.id}>
                          <td>{s.student_code}</td>
                          <td>{s.full_name}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setEditing(s)}
                            >
                              Sửa
                            </button>
                            <button
                              className="text-button danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Xóa ${s.full_name} khỏi danh sách lớp? Kết quả cũ vẫn được giữ.`,
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
                              Xóa
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!d.students.length && (
                <Empty>Nhập file hoặc thêm học sinh đầu tiên.</Empty>
              )}
            </section>
            <div>
              <form
                className="card form"
                key={editing?.id || "new"}
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = fields(e.currentTarget);
                  void run(async () => {
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
                  }, "Đã lưu học sinh.");
                }}
              >
                <h2>{editing ? "Sửa học sinh" : "Thêm học sinh"}</h2>
                <Field label="Mã học sinh">
                  <input
                    name="student_code"
                    defaultValue={editing?.student_code}
                    required
                    maxLength={50}
                  />
                </Field>
                <Field label="Họ tên">
                  <input
                    name="full_name"
                    defaultValue={editing?.full_name}
                    required
                    maxLength={150}
                  />
                </Field>
                <button className="primary">Lưu học sinh</button>
                {editing && (
                  <button type="button" onClick={() => setEditing(null)}>
                    Hủy sửa
                  </button>
                )}
              </form>
              <form
                className="card form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = fields(e.currentTarget);
                  void run(async () => {
                    await api(`/classes/${id}`, "PATCH", {
                      name: body.name,
                      archived: body.archived === "on",
                    });
                    resource.reload();
                  }, "Đã lưu lớp.");
                }}
              >
                <h3>Cài đặt lớp</h3>
                <Field label="Tên lớp">
                  <input name="name" defaultValue={d.name} required />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    name="archived"
                    defaultChecked={!!d.archived}
                  />{" "}
                  Lưu trữ lớp
                </label>
                <button>Lưu cài đặt</button>
              </form>
            </div>
          </div>
          <section className="card">
            <Importer
              kind="students"
              onCommit={async (rows) => {
                await api(`/classes/${id}/students/import`, "POST", { rows });
                resource.reload();
              }}
            />
          </section>
          <section className="card">
            <h2>Lịch sử buổi kiểm tra</h2>
            {d.sessions.map((s: Data) => (
              <a className="list-item" key={s.id} href={`/sessions/${s.id}`}>
                <strong>{s.name}</strong>
                <span>{stateLabel[s.state]}</span>
              </a>
            ))}
            {!d.sessions.length && <Empty>Lớp chưa có buổi kiểm tra.</Empty>}
          </section>
        </>
      )}
    </>
  );
}
const blankQuestion = {
  question: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "A",
  explanation: "",
  topic: "",
  difficulty: "medium",
};
export function Banks({ id }: { id?: string }) {
  const resource = useResource<Data>(
      id ? `/question-banks/${id}` : "/question-banks",
    ),
    { run } = useApp(),
    [editing, setEditing] = useState<Data | null>(null),
    [search, setSearch] = useState("");
  if (!resource.data) return <Status loading error={resource.error} />;
  const d = resource.data;
  return (
    <>
      <Head
        eyebrow="NGÂN HÀNG CÂU HỎI"
        title={id ? d.name : "Bài giảng hay, từ câu hỏi tốt."}
        description={
          id
            ? `${d.subject || "Chưa đặt môn học"} · ${d.questions.length} câu hỏi`
            : "Nhập đề, duyệt nội dung và chuẩn bị cho giờ học."
        }
      />
      <Status error={resource.error} />
      {!id ? (
        <div className="two-col">
          <section className="card">
            <Field label="Tìm bộ đề">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tên bộ đề hoặc môn học"
              />
            </Field>
            {(d as unknown as Data[])
              .filter((b) =>
                (b.name + b.subject)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((b) => (
                <a
                  className="list-item"
                  key={b.id}
                  href={`/question-banks/${b.id}`}
                >
                  <Icon name="file" />
                  <div>
                    <strong>{b.name}</strong>
                    <small>
                      {b.subject} · {b.question_count} câu
                    </small>
                  </div>
                  <span>→</span>
                </a>
              ))}
            {!d.length && (
              <Empty>Chưa có bộ đề. Tạo bộ đề rồi nhập XLSX/CSV.</Empty>
            )}
          </section>
          <form
            className="card form"
            onSubmit={(e) => {
              e.preventDefault();
              const body = fields(e.currentTarget);
              void run(async () => {
                const b = await api("/question-banks", "POST", body);
                window.location.href = `/question-banks/${b.id}`;
              });
            }}
          >
            <h2>Tạo bộ đề</h2>
            <Field label="Tên bộ đề">
              <input name="name" required maxLength={150} />
            </Field>
            <Field label="Môn học">
              <input name="subject" maxLength={100} />
            </Field>
            <button className="primary">Tạo bộ đề</button>
          </form>
        </div>
      ) : (
        <>
          <section className="card">
            <Importer
              kind="questions"
              onCommit={async (rows) => {
                await api("/imports/questions/commit", "POST", {
                  bank_id: id,
                  rows,
                });
                resource.reload();
              }}
            />
          </section>
          <div className="row spread">
            <h2>Câu hỏi đã lưu</h2>
            <div className="actions">
              <input
                placeholder="Tìm câu hỏi, chủ đề…"
                aria-label="Tìm câu hỏi"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="primary"
                onClick={() => setEditing({ ...blankQuestion })}
              >
                + Thêm câu hỏi
              </button>
            </div>
          </div>
          {editing && (
            <form
              className="card form question-editor"
              key={editing.id || "new"}
              onSubmit={(e) => {
                e.preventDefault();
                const body = fields(e.currentTarget);
                void run(async () => {
                  await api(
                    editing.id
                      ? `/questions/${editing.id}`
                      : `/question-banks/${id}/questions`,
                    editing.id ? "PATCH" : "POST",
                    body,
                  );
                  setEditing(null);
                  resource.reload();
                }, "Đã lưu câu hỏi.");
              }}
            >
              <h2>{editing.id ? "Sửa câu hỏi" : "Thêm câu hỏi"}</h2>
              <Field label="Nội dung câu hỏi">
                <textarea
                  name="question"
                  defaultValue={editing.question}
                  required
                  maxLength={2000}
                />
              </Field>
              <div className="form-grid">
                {["a", "b", "c", "d"].map((c) => (
                  <Field key={c} label={`Lựa chọn ${c.toUpperCase()}`}>
                    <input
                      name={`option_${c}`}
                      defaultValue={editing[`option_${c}`]}
                      required
                      maxLength={500}
                    />
                  </Field>
                ))}
                <Field label="Đáp án đúng">
                  <select
                    name="correct_answer"
                    defaultValue={editing.correct_answer}
                  >
                    {["A", "B", "C", "D"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Độ khó">
                  <select name="difficulty" defaultValue={editing.difficulty}>
                    <option value="easy">Dễ</option>
                    <option value="medium">Trung bình</option>
                    <option value="hard">Khó</option>
                  </select>
                </Field>
                <Field label="Chủ đề">
                  <input
                    name="topic"
                    defaultValue={editing.topic}
                    maxLength={100}
                  />
                </Field>
                <Field label="Lời giải">
                  <textarea
                    name="explanation"
                    defaultValue={editing.explanation}
                    maxLength={4000}
                  />
                </Field>
              </div>
              <div className="actions">
                <button className="primary">Lưu câu hỏi</button>
                <button type="button" onClick={() => setEditing(null)}>
                  Hủy sửa
                </button>
              </div>
            </form>
          )}
          {d.questions
            .filter((q: Data) =>
              (q.question + q.topic + q.difficulty)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((q: Data, i: number) => (
              <article className="card question-item" key={q.id}>
                <div className="row spread">
                  <span className="badge">
                    Câu {i + 1} · {q.topic || "Chưa có chủ đề"}
                  </span>
                  <div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditing(q);
                        setTimeout(
                          () =>
                            document
                              .querySelector(".question-editor")
                              ?.scrollIntoView({ block: "center" }),
                          0,
                        );
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (
                          confirm(
                            "Xóa câu hỏi khỏi bộ đề? Các bài đã bắt đầu vẫn giữ snapshot.",
                          )
                        )
                          void run(async () => {
                            await api(`/questions/${q.id}`, "DELETE");
                            resource.reload();
                          });
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
                <h3>{q.question}</h3>
                <div className="answer-grid">
                  {["A", "B", "C", "D"].map((c) => (
                    <div
                      key={c}
                      className={c === q.correct_answer ? "correct" : ""}
                    >
                      <b>{c}.</b> {q[`option_${c.toLowerCase()}`]}{" "}
                      {c === q.correct_answer && <small> · Đáp án đúng</small>}
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <p className="muted">Lời giải: {q.explanation}</p>
                )}
              </article>
            ))}
          {!d.questions.length && (
            <Empty>Bộ đề chưa có câu hỏi. Nhập file hoặc thêm câu hỏi.</Empty>
          )}
          <form
            className="card form narrow"
            onSubmit={(e) => {
              e.preventDefault();
              const body = fields(e.currentTarget);
              void run(async () => {
                await api(`/question-banks/${id}`, "PATCH", body);
                resource.reload();
              }, "Đã cập nhật bộ đề.");
            }}
          >
            <h3>Thông tin bộ đề</h3>
            <Field label="Tên bộ đề">
              <input name="name" defaultValue={d.name} required />
            </Field>
            <Field label="Môn học">
              <input name="subject" defaultValue={d.subject} />
            </Field>
            <button>Lưu thông tin</button>
          </form>
        </>
      )}
    </>
  );
}
export function Devices() {
  const r = useResource<Data[]>("/devices"),
    { run, user } = useApp(),
    [provision, setProvision] = useState<Data | null>(null);
  return (
    <>
      <Head
        eyebrow="THIẾT BỊ"
        title="Mỗi học sinh, một kết nối."
        description="Đăng ký, cấp lại thông tin và theo dõi thiết bị thuộc tài khoản."
      >
        {user.simulator && (
          <a className="button" href="/simulator">
            Mở giả lập ↗
          </a>
        )}
      </Head>
      {provision && (
        <section className="card">
          <h2>Thông tin kết nối — chỉ hiển thị một lần</h2>
          <p>
            Lưu riêng để provision ESP32. Trình giả lập dùng ticket, không cần
            secret này.
          </p>
          <Field label="Device ID">
            <input readOnly value={provision.id} />
          </Field>
          <Field label="Secret">
            <input readOnly value={provision.secret} />
          </Field>
          <button onClick={() => setProvision(null)}>Đã lưu thông tin</button>
        </section>
      )}
      <div className="two-col">
        <section className="card">
          <h2>Thiết bị đã đăng ký</h2>
          <Status loading={!r.data} error={r.error} />
          {r.data?.map((d) => (
            <div className="list-item" key={d.id}>
              <Icon name="device" />
              <div>
                <strong>{d.label}</strong>
                <small>
                  {d.revoked
                    ? "Đã thu hồi"
                    : d.online
                      ? "Đang kết nối"
                      : "Chưa kết nối"}
                  {d.last_seen
                    ? ` · ${new Date(d.last_seen).toLocaleString("vi-VN")}`
                    : ""}
                </small>
              </div>
              <div className="actions">
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "Cấp secret mới sẽ ngắt kết nối hiện tại. Tiếp tục?",
                      )
                    )
                      void run(async () => {
                        setProvision(
                          await api(`/devices/${d.id}/rotate-secret`, "POST"),
                        );
                        r.reload();
                      });
                  }}
                >
                  Cấp lại
                </button>
                <button
                  disabled={!!d.revoked}
                  onClick={() => {
                    if (confirm(`Thu hồi thiết bị ${d.label}?`))
                      void run(async () => {
                        await api(`/devices/${d.id}/revoke`, "POST");
                        r.reload();
                      });
                  }}
                >
                  Thu hồi
                </button>
              </div>
            </div>
          ))}
          {r.data?.length === 0 && (
            <Empty>Chưa có thiết bị. Đăng ký bên cạnh để bắt đầu.</Empty>
          )}
          <button onClick={r.reload}>Cập nhật trạng thái</button>
        </section>
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            const body = fields(e.currentTarget);
            void run(async () => {
              setProvision(await api("/devices", "POST", body));
              r.reload();
            }, "Đã đăng ký thiết bị.");
          }}
        >
          <h2>Đăng ký thiết bị</h2>
          <Field label="Nhãn thiết bị">
            <input name="label" placeholder="ESP-01" required maxLength={150} />
          </Field>
          <button className="primary">Đăng ký</button>
        </form>
      </div>
    </>
  );
}
export function ConfigFields({ config }: { config?: Data }) {
  const c = config || {
    count: 20,
    seconds: 30,
    random: true,
    auto_next: false,
    allow_change: true,
    pass_mark: 5,
  };
  return (
    <>
      <div className="form-grid">
        <Field label="Số câu">
          <input
            name="count"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={c.count}
          />
        </Field>
        <Field label="Thời gian / câu (giây)">
          <input
            name="seconds"
            type="number"
            min={5}
            max={300}
            required
            defaultValue={c.seconds}
          />
        </Field>
        <Field label="Ngưỡng đạt / 10">
          <input
            name="pass_mark"
            type="number"
            min={0}
            max={10}
            step="0.1"
            required
            defaultValue={c.pass_mark}
          />
        </Field>
      </div>
      <label className="check">
        <input name="random" type="checkbox" defaultChecked={c.random} /> Chọn
        câu ngẫu nhiên, không lặp
      </label>
      <label className="check">
        <input name="auto_next" type="checkbox" defaultChecked={c.auto_next} />{" "}
        Tự chuyển sau khi đóng câu 3 giây
      </label>
      <label className="check">
        <input
          name="allow_change"
          type="checkbox"
          defaultChecked={c.allow_change}
        />{" "}
        Cho đổi đáp án đến hết giờ
      </label>
    </>
  );
}
export function readConfig(f: Data) {
  return {
    count: Number(f.count),
    seconds: Number(f.seconds),
    pass_mark: Number(f.pass_mark),
    random: f.random === "on",
    auto_next: f.auto_next === "on",
    allow_change: f.allow_change === "on",
  };
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
        eyebrow="BUỔI KIỂM TRA MỚI"
        title="Chuẩn bị một giờ học mới."
        description="Chọn lớp, bộ đề và cách tổ chức bài kiểm tra."
      />
      <Status error={classes.error || banks.error} />
      <form className="card form setup" onSubmit={submit}>
        <Field label="Tên buổi kiểm tra">
          <input
            name="name"
            placeholder="Ôn tập chương I"
            required
            maxLength={150}
          />
        </Field>
        <div className="form-grid">
          <Field label="Lớp học">
            <select
              name="class_id"
              defaultValue={
                new URLSearchParams(location.search).get("class") || ""
              }
              required
            >
              <option value="">Chọn lớp</option>
              {classes.data
                ?.filter((c) => !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.student_count} học sinh
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Bộ đề">
            <select name="bank_id" required>
              <option value="">Chọn bộ đề</option>
              {banks.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.question_count} câu
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ConfigFields />
        <div className="actions">
          <button className="primary">Tạo phòng chờ →</button>
          <a href="/dashboard">Quay lại</a>
        </div>
      </form>
      {classes.data?.length === 0 && (
        <p className="alert">
          Cần <a href="/classes">tạo lớp và học sinh</a> trước.
        </p>
      )}
      {banks.data?.length === 0 && (
        <p className="alert">
          Cần <a href="/question-banks">tạo bộ đề và nhập câu hỏi</a> trước.
        </p>
      )}
    </>
  );
}
