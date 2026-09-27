import { useState } from "react";
import { api, fmt, stateLabel, eventLabel, type Data } from "../api";
import { Empty, Head, Status, useApp, useResource } from "../components";
export function Reports({ id }: { id?: string }) {
  const r = useResource<Data>(id ? `/sessions/${id}/report` : "/sessions"),
    { run } = useApp(),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  if (!r.data) return <Status loading error={r.error} />;
  const d = r.data;
  if (!id)
    return (
      <>
        <Head
          eyebrow="BÁO CÁO"
          title="Hiểu lớp học qua từng câu trả lời."
          description="Xem kết quả, tìm câu cần ôn lại và xuất bảng điểm."
        />
        <section className="card">
          <label className="field">
            Tìm buổi kiểm tra
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên buổi hoặc lớp"
            />
          </label>
          {(d as unknown as Data[])
            .filter((s) =>
              (s.name + s.class_name)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((s) => (
              <a className="list-item" key={s.id} href={`/reports/${s.id}`}>
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
          {!d.length && (
            <Empty>
              Chưa có báo cáo. Kết quả sẽ xuất hiện sau khi tạo buổi kiểm tra.
            </Empty>
          )}
        </section>
      </>
    );
  const student = d.students.find((s: Data) => s.id === selected);
  return (
    <>
      <Head
        eyebrow="BÁO CÁO BUỔI KIỂM TRA"
        title={d.session.name}
        description={`${d.session.class_name} · ${stateLabel[d.session.state]} · ${d.N}/${d.session.config.count} câu tính điểm${d.session.early_finish ? " · Kết thúc sớm" : ""}`}
      >
        <a className="button primary" href={`/api/sessions/${id}/export.xlsx`}>
          Xuất Excel ↓
        </a>
        <button onClick={() => window.print()}>In / Lưu PDF</button>
      </Head>
      {!["FINISHED", "CANCELLED"].includes(d.session.state) && (
        <p className="warning">
          Buổi chưa kết thúc. Đây là thống kê tạm thời của các câu đã đóng.{" "}
          <a href={`/sessions/${id}`}>Về phòng kiểm tra →</a>
        </p>
      )}
      {d.session.state === "CANCELLED" && (
        <p className="alert">Buổi đã hủy — không có điểm chính thức.</p>
      )}
      {!d.N && (
        <p className="warning">
          Chưa có điểm: không có câu đã đóng hợp lệ để tính điểm.
        </p>
      )}
      <div className="stat-grid">
        <div className="card stat">
          <span>Điểm trung bình</span>
          <strong>{fmt(d.stats.mean)}</strong>
          <small>Ngưỡng đạt: {d.session.config.pass_mark}/10</small>
        </div>
        <div className="card stat">
          <span>Tỷ lệ đạt</span>
          <strong>{fmt(d.stats.pass_rate, "%")}</strong>
          <small>{d.stats.participants} người dự thi</small>
        </div>
        <div className="card stat">
          <span>Trả lời đủ {d.N} câu</span>
          <strong>
            {d.stats.complete}/{d.stats.participants}
          </strong>
          <small>
            {d.students.length - d.stats.participants} học sinh vắng
          </small>
        </div>
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Phân bố điểm</h2>
          <div className="histogram">
            {d.stats.distribution.map((count: number, i: number) => (
              <div key={i}>
                <span>{count}</span>
                <div
                  className="hist-bar"
                  style={{
                    height: Math.max(
                      2,
                      (count / Math.max(1, ...d.stats.distribution)) * 120,
                    ),
                  }}
                />
                <small>
                  {["[0, 2)", "[2, 4)", "[4, 6)", "[6, 8)", "[8, 10]"][i]}
                </small>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Thống kê lớp</h2>
          <dl className="metrics">
            <div>
              <dt>Trung vị</dt>
              <dd>{fmt(d.stats.median)}</dd>
            </div>
            <div>
              <dt>Cao nhất</dt>
              <dd>{fmt(d.stats.max)}</dd>
            </div>
            <div>
              <dt>Thấp nhất</dt>
              <dd>{fmt(d.stats.min)}</dd>
            </div>
          </dl>
          <p className="muted">
            Học sinh vắng không nằm trong thống kê điểm. Học sinh dự thi nhưng
            mất kết nối vẫn tính bỏ trống.
          </p>
        </section>
      </div>
      <section className="card">
        <div className="row spread">
          <h2>Kết quả học sinh</h2>
          <input
            aria-label="Tìm học sinh báo cáo"
            placeholder="Tìm học sinh…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Học sinh</th>
                <th>Đúng</th>
                <th>Sai</th>
                <th>Bỏ trống</th>
                <th>Điểm</th>
                <th>Trả lời</th>
                <th>Kết quả</th>
                <th>Chi tiết</th>
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
                    <td>
                      {s.full_name}
                      <small>{s.student_code}</small>
                    </td>
                    <td>{s.absent ? "—" : s.C}</td>
                    <td>{s.absent ? "—" : s.W}</td>
                    <td>{s.absent ? "—" : s.U}</td>
                    <td>
                      <b>{fmt(s.score)}</b>
                    </td>
                    <td>{fmt(s.answer_rate, "%")}</td>
                    <td>
                      {s.absent
                        ? "Vắng"
                        : s.passed == null
                          ? "Chưa có điểm"
                          : s.passed
                            ? "Đạt"
                            : "Chưa đạt"}
                    </td>
                    <td>
                      <button onClick={() => setSelected(s.id)}>Xem</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {student && (
        <section className="card">
          <div className="row spread">
            <h2>Chi tiết: {student.full_name}</h2>
            <button onClick={() => setSelected("")}>Đóng chi tiết</button>
          </div>
          <p>
            Đúng: {fmt(student.correct_rate, "%")} · Phản hồi trung bình:{" "}
            {student.response_ms == null
              ? "—"
              : fmt(student.response_ms / 1000, " giây")}{" "}
            (có ảnh hưởng của độ trễ mạng)
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Câu</th>
                  <th>Lựa chọn</th>
                  <th>Đáp án đúng</th>
                  <th>Phản hồi</th>
                  <th>Tính điểm</th>
                </tr>
              </thead>
              <tbody>
                {student.details.map((a: Data) => (
                  <tr key={a.question_id}>
                    <td>{a.order}</td>
                    <td>{a.choice || "Bỏ trống"}</td>
                    <td>{a.correct_answer}</td>
                    <td>
                      {a.response_ms == null
                        ? "—"
                        : fmt(a.response_ms / 1000, "s")}
                    </td>
                    <td>{a.scored ? "Có" : "Không"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="card">
        <h2>Phân tích từng câu</h2>
        {d.questions.map((q: Data) => (
          <article className="report-question" key={q.id}>
            <div className="row spread">
              <h3>
                Câu {q.question_order}. {q.data.question}
              </h3>
              <span className="badge">
                {q.voided ? "Đã loại" : stateLabel[q.status]}
              </span>
            </div>
            <p>
              Đáp án đúng: <b>{q.data.correct_answer}</b> · Tỷ lệ đúng:{" "}
              {q.correct_rate == null ? "—" : fmt(q.correct_rate, "%")} · Bỏ
              trống: {q.blank ?? "—"}
            </p>
            <div className="choice-counts">
              {["A", "B", "C", "D"].map((c) => (
                <span key={c}>
                  {c}: <b>{q.counts[c]}</b>
                </span>
              ))}
            </div>
            {q.data.explanation && <p>Lời giải: {q.data.explanation}</p>}
            {q.voided ? (
              <p className="warning">Lý do loại: {q.void_reason}</p>
            ) : (
              q.status === "CLOSED" && (
                <form
                  className="row no-print"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const reason = String(
                      new FormData(e.currentTarget).get("reason"),
                    );
                    if (confirm("Loại câu này và tính lại điểm toàn lớp?"))
                      void run(async () => {
                        await api(
                          `/sessions/${id}/questions/${q.id}/void`,
                          "POST",
                          { reason },
                        );
                        r.reload();
                      }, "Đã loại câu và tính lại báo cáo.");
                  }}
                >
                  <input
                    name="reason"
                    aria-label={`Lý do loại câu ${q.question_order}`}
                    placeholder="Lý do loại câu"
                    minLength={3}
                    maxLength={500}
                    required
                  />
                  <button className="danger">Loại câu khỏi tính điểm</button>
                </form>
              )
            )}
          </article>
        ))}
      </section>
      <details className="card">
        <summary>Nhật ký buổi và sự cố ({d.events.length})</summary>
        {d.events.map((e: Data) => (
          <p key={e.id}>
            {new Date(e.created_at).toLocaleString("vi-VN")} ·{" "}
            {eventLabel[e.type] || "Sự kiện buổi kiểm tra"}{" "}
            {JSON.parse(e.detail).reason || JSON.parse(e.detail).message || ""}
          </p>
        ))}
      </details>
    </>
  );
}
