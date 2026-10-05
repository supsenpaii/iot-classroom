import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, type Row, all, one, owned, must, AppError } from "./db.js";
import {
  pollSchema,
  pollVoteSchema,
  attendanceCheckinSchema,
} from "../shared/protocol.js";
const CHOICES = ["A", "B", "C", "D"];
// A device answering a quiz (RUNNING/PAUSED) always stays with the quiz.
export function busyInQuiz(db: DB, device: string) {
  return !!one(
    db,
    "SELECT 1 FROM session_devices b JOIN quiz_sessions s ON s.id=b.session_id WHERE b.device_id=? AND b.active=1 AND s.state IN ('RUNNING','PAUSED')",
    device,
  );
}
// Devices follow one live activity at a time, so a teacher can run only one flashcard review, poll or check-in.
export function assertIdle(db: DB, owner: string) {
  const checks: [string, string, string][] = [
    [
      "SELECT 1 FROM quiz_sessions WHERE owner_teacher_id=? AND state IN ('RUNNING','PAUSED')",
      "QUIZ_RUNNING",
      "Đang có buổi kiểm tra chạy. Kết thúc bài kiểm tra trước.",
    ],
    [
      "SELECT 1 FROM flashcard_reviews WHERE owner_teacher_id=? AND state='RUNNING'",
      "REVIEW_RUNNING",
      "Đang có một buổi ôn flashcard. Kết thúc buổi đó trước.",
    ],
    [
      "SELECT 1 FROM polls WHERE owner_teacher_id=? AND state='RUNNING'",
      "POLL_RUNNING",
      "Đang có một khảo sát mở. Đóng khảo sát đó trước.",
    ],
    [
      "SELECT 1 FROM attendance_sessions WHERE owner_teacher_id=? AND state='OPEN'",
      "ATTENDANCE_OPEN",
      "Đang mở điểm danh. Đóng điểm danh trước.",
    ],
  ];
  for (const [sql, code, message] of checks)
    if (one(db, sql, owner)) throw new AppError(code, message, 409);
}
const ownerOf = (db: DB, device: string) =>
  one(db, "SELECT owner_teacher_id FROM devices WHERE id=? AND revoked=0", device)
    ?.owner_teacher_id as string | undefined;
export const pollCommandSchema = z.object({ action: z.enum(["reveal", "close"]) });
export class Polls {
  constructor(
    public db: DB,
    public now = () => Date.now(),
  ) {}
  create(owner: string, input: unknown) {
    const p = pollSchema.parse(input);
    assertIdle(this.db, owner);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO polls(id,owner_teacher_id,question,options,hide_results,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, owner, p.question, JSON.stringify(p.options), +p.hide_results, this.now());
    return id;
  }
  list(owner: string) {
    return all(
      this.db,
      "SELECT p.id,p.question,p.state,p.created_at,(SELECT count(*) FROM poll_votes WHERE poll_id=p.id) votes FROM polls p WHERE owner_teacher_id=? ORDER BY created_at DESC LIMIT 30",
      owner,
    );
  }
  command(owner: string, id: string, action: string) {
    const p = owned(this.db, "polls", id, owner);
    if (p.state !== "RUNNING")
      throw new AppError("POLL_CLOSED", "Khảo sát đã đóng", 409);
    if (action === "close")
      this.db
        .prepare(
          "UPDATE polls SET state='CLOSED',hide_results=0,closed_at=?,state_version=state_version+1 WHERE id=?",
        )
        .run(this.now(), id);
    else
      this.db
        .prepare(
          "UPDATE polls SET hide_results=0,state_version=state_version+1 WHERE id=?",
        )
        .run(id);
  }
  snapshot(id: string, online: (device: string) => boolean) {
    const p = must(one(this.db, "SELECT * FROM polls WHERE id=?", id));
    const labels: string[] = JSON.parse(p.options);
    const counts = new Map(
      all(
        this.db,
        "SELECT choice,count(*) n FROM poll_votes WHERE poll_id=? GROUP BY choice",
        id,
      ).map((r) => [r.choice, r.n as number]),
    );
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return {
      mode: "poll",
      id: p.id,
      question: p.question,
      state: p.state,
      state_version: p.state_version,
      server_time: this.now(),
      hide_results: !!p.hide_results,
      created_at: p.created_at,
      closed_at: p.closed_at,
      total_votes: total,
      devices_online: all(
        this.db,
        "SELECT id FROM devices WHERE owner_teacher_id=? AND revoked=0",
        p.owner_teacher_id,
      ).filter((d) => online(d.id) && !busyInQuiz(this.db, d.id)).length,
      options: labels.map((label, i) => ({
        key: CHOICES[i],
        label,
        count: counts.get(CHOICES[i]) ?? 0,
      })),
    };
  }
  deviceSnapshot(device: string) {
    const owner = ownerOf(this.db, device);
    if (!owner || busyInQuiz(this.db, device)) return null;
    const p = one(
      this.db,
      "SELECT * FROM polls WHERE owner_teacher_id=? AND state='RUNNING'",
      owner,
    );
    if (!p) return null;
    return {
      mode: "poll",
      id: p.id,
      state: "RUNNING",
      state_version: p.state_version,
      server_time: this.now(),
      options: JSON.parse(p.options).length,
      current_choice:
        one(
          this.db,
          "SELECT choice FROM poll_votes WHERE poll_id=? AND device_id=?",
          p.id,
          device,
        )?.choice ?? null,
    };
  }
  vote(device: string, input: unknown) {
    const v = pollVoteSchema.parse(input);
    const reject = (code: string) => ({
      v: 1,
      type: "poll.ack",
      request_id: v.request_id,
      accepted: false,
      code,
    });
    return this.db.transaction((): Row => {
      const owner = ownerOf(this.db, device);
      if (!owner) return reject("DEVICE_NOT_ASSIGNED");
      if (busyInQuiz(this.db, device)) return reject("DEVICE_BUSY");
      const p = one(
        this.db,
        "SELECT * FROM polls WHERE id=? AND owner_teacher_id=?",
        v.poll_id,
        owner,
      );
      if (!p || p.state !== "RUNNING") return reject("POLL_CLOSED");
      if (CHOICES.indexOf(v.choice) >= JSON.parse(p.options).length)
        return reject("INVALID_CHOICE");
      this.db
        .prepare(
          "INSERT INTO poll_votes VALUES (?,?,?,?) ON CONFLICT(poll_id,device_id) DO UPDATE SET choice=excluded.choice,updated_at=excluded.updated_at",
        )
        .run(p.id, device, v.choice, this.now());
      return {
        v: 1,
        type: "poll.ack",
        request_id: v.request_id,
        accepted: true,
        choice: v.choice,
      };
    })();
  }
}
export const attendanceCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close") }),
  z.object({
    action: z.literal("mark"),
    student_id: z.string().max(80),
    status: z.enum(["PRESENT", "ABSENT"]),
  }),
]);
export class Attendance {
  constructor(
    public db: DB,
    public now = () => Date.now(),
  ) {}
  create(owner: string, classId: string) {
    const cls = owned(this.db, "classes", classId, owner);
    if (cls.archived) throw new AppError("ARCHIVED", "Lớp đã lưu trữ");
    const students = all(
      this.db,
      "SELECT s.*,sd.device_id FROM students s LEFT JOIN student_devices sd ON sd.student_id=s.id WHERE s.class_id=? ORDER BY s.student_code",
      cls.id,
    );
    if (!students.length)
      throw new AppError("NO_STUDENTS", "Lớp chưa có học sinh để điểm danh");
    assertIdle(this.db, owner);
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO attendance_sessions(id,owner_teacher_id,class_id,class_name,created_at) VALUES (?,?,?,?,?)",
        )
        .run(id, owner, cls.id, cls.name, this.now());
      const insert = this.db.prepare(
        "INSERT INTO attendance_marks(attendance_id,student_id,student_code,full_name,device_id) VALUES (?,?,?,?,?)",
      );
      for (const s of students)
        insert.run(id, s.id, s.student_code, s.full_name, s.device_id ?? null);
    })();
    return id;
  }
  list(owner: string) {
    return all(
      this.db,
      "SELECT a.id,a.class_id,a.class_name,a.state,a.created_at,a.closed_at,(SELECT count(*) FROM attendance_marks WHERE attendance_id=a.id AND status='PRESENT') present,(SELECT count(*) FROM attendance_marks WHERE attendance_id=a.id) total FROM attendance_sessions a WHERE owner_teacher_id=? ORDER BY created_at DESC LIMIT 30",
      owner,
    );
  }
  command(owner: string, id: string, input: unknown) {
    const cmd = attendanceCommandSchema.parse(input);
    const a = owned(this.db, "attendance_sessions", id, owner);
    if (a.state !== "OPEN" && cmd.action === "close")
      throw new AppError("ATTENDANCE_CLOSED", "Điểm danh đã đóng", 409);
    this.db.transaction(() => {
      if (cmd.action === "close")
        this.db
          .prepare(
            "UPDATE attendance_sessions SET state='CLOSED',closed_at=? WHERE id=?",
          )
          .run(this.now(), id);
      // Corrections stay possible after closing: a teacher may fix a mistake when exporting.
      else if (
        !this.db
          .prepare(
            "UPDATE attendance_marks SET status=?,method='MANUAL',marked_at=? WHERE attendance_id=? AND student_id=?",
          )
          .run(cmd.status, cmd.status === "PRESENT" ? this.now() : null, id, cmd.student_id)
          .changes
      )
        throw new AppError("NOT_FOUND", "Không tìm thấy học sinh trong buổi điểm danh", 404);
      this.db
        .prepare(
          "UPDATE attendance_sessions SET state_version=state_version+1 WHERE id=?",
        )
        .run(id);
    })();
  }
  snapshot(id: string, online: (device: string) => boolean) {
    const a = must(one(this.db, "SELECT * FROM attendance_sessions WHERE id=?", id));
    const students = all(
      this.db,
      "SELECT m.*,d.label device_label FROM attendance_marks m LEFT JOIN devices d ON d.id=m.device_id WHERE m.attendance_id=? ORDER BY m.student_code",
      id,
    ).map((m) => ({
      student_id: m.student_id,
      student_code: m.student_code,
      full_name: m.full_name,
      device_label: m.device_label,
      online: !!m.device_id && online(m.device_id),
      status: m.status,
      method: m.method,
      marked_at: m.marked_at,
    }));
    return {
      mode: "attendance",
      id: a.id,
      class_id: a.class_id,
      class_name: a.class_name,
      state: a.state,
      state_version: a.state_version,
      server_time: this.now(),
      created_at: a.created_at,
      closed_at: a.closed_at,
      present: students.filter((s) => s.status === "PRESENT").length,
      total: students.length,
      students,
    };
  }
  private openFor(device: string) {
    return one(
      this.db,
      "SELECT a.id,a.state_version,m.status FROM attendance_sessions a JOIN attendance_marks m ON m.attendance_id=a.id JOIN devices d ON d.id=m.device_id WHERE m.device_id=? AND d.revoked=0 AND a.owner_teacher_id=d.owner_teacher_id AND a.state='OPEN'",
      device,
    );
  }
  deviceSnapshot(device: string) {
    if (busyInQuiz(this.db, device)) return null;
    const a = this.openFor(device);
    if (!a) return null;
    return {
      mode: "attendance",
      id: a.id,
      state: "RUNNING",
      state_version: a.state_version,
      server_time: this.now(),
      checked_in: a.status === "PRESENT",
    };
  }
  checkin(device: string, input: unknown) {
    const c = attendanceCheckinSchema.parse(input);
    const reject = (code: string) => ({
      v: 1,
      type: "attendance.ack",
      request_id: c.request_id,
      accepted: false,
      code,
    });
    return this.db.transaction((): Row => {
      if (busyInQuiz(this.db, device)) return reject("DEVICE_BUSY");
      const a = this.openFor(device);
      if (!a) return reject("DEVICE_NOT_ASSIGNED");
      if (a.id !== c.attendance_id) return reject("ATTENDANCE_CLOSED");
      // Keep the first check-in time; pressing again is harmless.
      if (a.status !== "PRESENT") {
        this.db
          .prepare(
            "UPDATE attendance_marks SET status='PRESENT',method='DEVICE',marked_at=? WHERE attendance_id=? AND device_id=?",
          )
          .run(this.now(), a.id, device);
        this.db
          .prepare(
            "UPDATE attendance_sessions SET state_version=state_version+1 WHERE id=?",
          )
          .run(a.id);
      }
      return {
        v: 1,
        type: "attendance.ack",
        request_id: c.request_id,
        accepted: true,
      };
    })();
  }
}
