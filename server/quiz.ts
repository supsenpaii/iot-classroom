import { randomInt, randomUUID } from "node:crypto";
import { type DB, type Row, all, one, owned, must, AppError } from "./db.js";
import {
  answerSchema,
  configSchema,
  type AnswerPacket,
  type Config,
} from "../shared/protocol.js";
import { hash } from "./auth.js";
import { standings } from "./leaderboard.js";
export class Quiz {
  constructor(
    public db: DB,
    public now = () => Date.now(),
  ) {}
  event(
    id: string,
    type: string,
    detail: unknown = {},
    actor: string | null = null,
  ) {
    this.db
      .prepare(
        "INSERT INTO session_events(session_id,type,actor,detail,created_at) VALUES (?,?,?,?,?)",
      )
      .run(id, type, actor, JSON.stringify(detail), this.now());
  }
  get(id: string) {
    return must(one(this.db, "SELECT * FROM quiz_sessions WHERE id=?", id));
  }
  current(id: string) {
    return one(
      this.db,
      "SELECT q.* FROM session_questions q JOIN quiz_sessions s ON s.id=q.session_id AND s.current_order=q.question_order WHERE s.id=?",
      id,
    );
  }
  create(
    owner: string,
    input: { class_id: string; bank_id: string; name: string; config: Config },
  ) {
    const cls = owned(this.db, "classes", input.class_id, owner);
    owned(this.db, "question_banks", input.bank_id, owner);
    if (cls.archived) throw new AppError("ARCHIVED", "Lớp đã lưu trữ");
    const config = configSchema.parse(input.config);
    this.validateCount(input.bank_id, config.count);
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          owner,
          cls.id,
          input.bank_id,
          cls.name,
          input.name,
          String(randomInt(100000, 1000000)),
          JSON.stringify(config),
          this.now(),
        );
      for (const st of all(
        this.db,
        "SELECT s.*,sd.device_id FROM students s LEFT JOIN student_devices sd ON sd.student_id=s.id LEFT JOIN devices d ON d.id=sd.device_id AND d.revoked=0 WHERE s.class_id=?",
        cls.id,
      )) {
        const sessionStudent = randomUUID();
        this.db
          .prepare(
            "INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES (?,?,?,?,?)",
          )
          .run(sessionStudent, id, st.id, st.student_code, st.full_name);
        // Pre-bind the student's default device unless another unfinished room still holds it.
        if (
          st.device_id &&
          one(this.db, "SELECT 1 FROM devices WHERE id=? AND revoked=0", st.device_id) &&
          !one(
            this.db,
            "SELECT 1 FROM session_devices WHERE device_id=? AND active=1",
            st.device_id,
          )
        ) {
          this.db
            .prepare("INSERT INTO session_devices VALUES (?,?,?,?,1,?)")
            .run(randomUUID(), id, sessionStudent, st.device_id, this.now());
          this.event(id, "binding.changed", {
            student: sessionStudent,
            device: st.device_id,
            source: "default",
          }, owner);
        }
      }
    })();
    return id;
  }
  validateCount(bank: string, count: number) {
    if (
      Number(
        one(this.db, "SELECT count(*) n FROM questions WHERE bank_id=?", bank)
          ?.n,
      ) < count
    )
      throw new AppError("INSUFFICIENT_QUESTIONS", "Bộ đề không đủ câu hỏi");
  }
  bind(id: string, student: string, device: string | null, owner: string) {
    return this.db.transaction(() => {
      const s = owned(this.db, "quiz_sessions", id, owner);
      if (!["LOBBY", "PAUSED"].includes(s.state))
        throw new AppError(
          "INVALID_STATE",
          "Chỉ ghép thiết bị trong phòng chờ hoặc khi tạm dừng",
          409,
        );
      const st = must(
        one(
          this.db,
          "SELECT * FROM session_students WHERE id=? AND session_id=?",
          student,
          id,
        ),
      );
      if (st.absent)
        throw new AppError("ABSENT", "Học sinh được đánh dấu vắng");
      if (device) {
        const d = owned(this.db, "devices", device, owner);
        if (d.revoked)
          throw new AppError("DEVICE_REVOKED", "Thiết bị đã thu hồi");
        const occupied = one(
          this.db,
          "SELECT * FROM session_devices WHERE device_id=? AND active=1",
          device,
        );
        if (occupied && occupied.session_student_id !== student)
          throw new AppError(
            "DEVICE_IN_USE",
            "Thiết bị đang ghép với học sinh khác",
            409,
          );
      }
      this.db
        .prepare(
          "UPDATE session_devices SET active=0 WHERE session_student_id=?",
        )
        .run(student);
      if (device)
        this.db
          .prepare("INSERT INTO session_devices VALUES (?,?,?,?,1,?)")
          .run(randomUUID(), id, student, device, this.now());
      this.db
        .prepare(
          "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
        )
        .run(id);
      this.event(id, "binding.changed", { student, device }, owner);
    })();
  }
  open(id: string, order: number) {
    const s = this.get(id),
      now = this.now();
    this.db
      .prepare(
        "UPDATE session_questions SET status='OPEN',opened_at=?,deadline_at=? WHERE session_id=? AND question_order=? AND status='PENDING'",
      )
      .run(now, now + JSON.parse(s.config).seconds * 1000, id, order);
    this.db
      .prepare(
        "UPDATE quiz_sessions SET current_order=?,next_transition_at=NULL,transition_remaining=NULL WHERE id=?",
      )
      .run(order, id);
    this.event(id, "question.opened", { question_id: this.current(id)?.id });
  }
  finish(id: string, state = "FINISHED", early = false) {
    const now = this.now();
    this.db
      .prepare(
        "UPDATE session_questions SET status='CLOSED',closed_at=?,deadline_at=NULL WHERE session_id=? AND status='OPEN'",
      )
      .run(now, id);
    this.db
      .prepare(
        "UPDATE quiz_sessions SET state=?,finished_at=?,early_finish=?,next_transition_at=NULL WHERE id=?",
      )
      .run(state, now, +early, id);
    this.db
      .prepare("UPDATE session_devices SET active=0 WHERE session_id=?")
      .run(id);
    this.db
      .prepare(
        "DELETE FROM access_tokens WHERE kind LIKE 'projection%' AND resource_id=?",
      )
      .run(id);
  }
  closeQuestion(id: string, recovery = false) {
    const s = this.get(id),
      q = this.current(id);
    if (!q || q.status !== "OPEN") return;
    this.db
      .prepare(
        "UPDATE session_questions SET status='CLOSED',closed_at=?,remaining_ms=NULL WHERE id=?",
      )
      .run(Math.min(this.now(), q.deadline_at ?? this.now()), q.id);
    const cfg: Config = JSON.parse(s.config);
    if (!recovery && s.current_order === cfg.count) this.finish(id);
    else if (cfg.auto_next)
      this.db
        .prepare("UPDATE quiz_sessions SET next_transition_at=? WHERE id=?")
        .run(this.now() + 3000, id);
    this.event(id, "question.closed", { question_id: q.id });
  }
  tick() {
    const s = one(this.db, "SELECT * FROM quiz_sessions WHERE state='RUNNING'");
    if (!s) return false;
    const q = this.current(s.id),
      now = this.now();
    if (q?.status === "OPEN" && now >= q.deadline_at) {
      this.db.transaction(() => {
        this.closeQuestion(s.id);
        this.db
          .prepare(
            "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
          )
          .run(s.id);
      })();
      return true;
    }
    if (
      q?.status === "CLOSED" &&
      s.next_transition_at &&
      now >= s.next_transition_at
    ) {
      this.db.transaction(() => {
        this.open(s.id, s.current_order + 1);
        this.db
          .prepare(
            "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
          )
          .run(s.id);
      })();
      return true;
    }
    return false;
  }
  recover() {
    this.db.transaction(() => {
      for (const s of all(
        this.db,
        "SELECT * FROM quiz_sessions WHERE state='RUNNING'",
      )) {
        const q = this.current(s.id),
          now = this.now();
        if (q?.status === "OPEN") {
          if (q.deadline_at <= now) this.closeQuestion(s.id, true);
          else
            this.db
              .prepare("UPDATE session_questions SET remaining_ms=? WHERE id=?")
              .run(q.deadline_at - now, q.id);
        }
        this.db
          .prepare(
            "UPDATE quiz_sessions SET state='PAUSED',paused_at=?,next_transition_at=NULL,transition_remaining=?,state_version=state_version+1 WHERE id=?",
          )
          .run(
            now,
            s.next_transition_at
              ? Math.max(0, s.next_transition_at - now)
              : 3000,
            s.id,
          );
        this.event(s.id, "server.recovered", {
          message:
            "Máy chủ khởi động lại. Kiểm tra câu bị ảnh hưởng trước khi tiếp tục.",
        });
      }
    })();
  }
  command(
    id: string,
    owner: string,
    input: { command_id: string; expected_version: number; action: string },
  ) {
    return this.db.transaction(() => {
      const s = owned(this.db, "quiz_sessions", id, owner),
        digest = hash(JSON.stringify(input));
      const receipt = one(
        this.db,
        "SELECT * FROM commands WHERE session_id=? AND command_id=?",
        id,
        input.command_id,
      );
      if (receipt) {
        if (receipt.payload_hash !== digest)
          throw new AppError(
            "COMMAND_REUSED",
            "Mã lệnh đã dùng với nội dung khác",
            409,
          );
        return { ...JSON.parse(receipt.result), duplicate: true };
      }
      if (s.state_version !== input.expected_version)
        throw new AppError(
          "VERSION_CONFLICT",
          "Trạng thái đã thay đổi; hãy dùng trạng thái mới nhất",
          409,
          this.snapshot(id),
        );
      const cfg: Config = JSON.parse(s.config),
        q = this.current(id),
        now = this.now();
      const requireState = (...states: string[]) => {
        if (!states.includes(s.state))
          throw new AppError(
            "INVALID_STATE",
            "Thao tác không phù hợp với trạng thái buổi",
            409,
          );
      };
      switch (input.action) {
        case "start": {
          requireState("LOBBY");
          if (
            one(
              this.db,
              "SELECT id FROM quiz_sessions WHERE state IN ('RUNNING','PAUSED')",
            )
          )
            throw new AppError("ROOM_BUSY", "Đang có một phòng hoạt động", 409);
          if (
            !one(
              this.db,
              "SELECT 1 FROM session_students WHERE session_id=? AND absent=0",
              id,
            )
          )
            throw new AppError(
              "NO_STUDENTS",
              "Cần ít nhất một học sinh dự thi",
            );
          if (
            one(
              this.db,
              "SELECT count(*) n FROM session_students WHERE session_id=? AND absent=0",
              id,
            )!.n > 50
          )
            throw new AppError(
              "ROOM_LIMIT",
              "Bản đầu hỗ trợ tối đa 50 học sinh dự thi",
            );
          this.validateCount(s.bank_id, cfg.count);
          const questions = all(
            this.db,
            "SELECT * FROM questions WHERE bank_id=? ORDER BY rowid",
            s.bank_id,
          );
          if (cfg.random)
            for (let i = questions.length - 1; i > 0; i--) {
              const j = randomInt(i + 1);
              [questions[i], questions[j]] = [questions[j], questions[i]];
            }
          questions
            .slice(0, cfg.count)
            .forEach((item, i) =>
              this.db
                .prepare(
                  "INSERT INTO session_questions(id,session_id,question_order,data) VALUES (?,?,?,?)",
                )
                .run(randomUUID(), id, i + 1, item.data),
            );
          this.db
            .prepare("UPDATE quiz_sessions SET state='RUNNING' WHERE id=?")
            .run(id);
          this.open(id, 1);
          break;
        }
        case "pause":
          requireState("RUNNING");
          if (q?.status === "OPEN" && now >= q.deadline_at)
            throw new AppError(
              "QUESTION_CLOSED",
              "Câu đã hết giờ. Đồng bộ lại trạng thái",
              409,
            );
          if (q?.status === "OPEN")
            this.db
              .prepare("UPDATE session_questions SET remaining_ms=? WHERE id=?")
              .run(q.deadline_at - now, q.id);
          this.db
            .prepare(
              "UPDATE quiz_sessions SET state='PAUSED',paused_at=?,transition_remaining=?,next_transition_at=NULL WHERE id=?",
            )
            .run(
              now,
              s.next_transition_at
                ? Math.max(0, s.next_transition_at - now)
                : null,
              id,
            );
          break;
        case "resume":
          requireState("PAUSED");
          if (q?.status === "OPEN")
            this.db
              .prepare(
                "UPDATE session_questions SET deadline_at=?,pause_ms=pause_ms+?,remaining_ms=NULL WHERE id=?",
              )
              .run(now + q.remaining_ms, now - s.paused_at, q.id);
          this.db
            .prepare(
              "UPDATE quiz_sessions SET state='RUNNING',paused_at=NULL,next_transition_at=? WHERE id=?",
            )
            .run(
              q?.status === "CLOSED" && cfg.auto_next
                ? now + (s.transition_remaining ?? 3000)
                : null,
              id,
            );
          if (q?.status === "CLOSED" && s.current_order === cfg.count)
            this.finish(id);
          break;
        case "close-question":
          requireState("RUNNING");
          if (q?.status !== "OPEN")
            throw new AppError("QUESTION_CLOSED", "Câu đã đóng", 409);
          this.closeQuestion(id);
          break;
        case "reveal-results":
          requireState("RUNNING", "PAUSED");
          if (q?.status !== "CLOSED")
            throw new AppError("QUESTION_OPEN", "Chỉ công bố khi câu đã đóng", 409);
          this.db
            .prepare("UPDATE session_questions SET results_revealed=1 WHERE id=?")
            .run(q.id);
          break;
        case "next":
          requireState("RUNNING");
          if (q?.status !== "CLOSED")
            throw new AppError(
              "QUESTION_OPEN",
              "Hãy đóng câu hiện tại trước",
              409,
            );
          if (s.current_order < cfg.count) this.open(id, s.current_order + 1);
          else this.finish(id);
          break;
        case "finish":
          requireState("RUNNING", "PAUSED");
          this.finish(id, "FINISHED", s.current_order < cfg.count);
          break;
        case "cancel":
          requireState("LOBBY", "RUNNING", "PAUSED");
          this.finish(id, "CANCELLED");
          break;
        default:
          throw new AppError("INVALID_COMMAND", "Lệnh không hợp lệ");
      }
      this.db
        .prepare(
          "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
        )
        .run(id);
      this.event(id, input.action, {}, owner);
      const result = this.snapshot(id);
      this.db
        .prepare("INSERT INTO commands VALUES (?,?,?,?)")
        .run(id, input.command_id, digest, JSON.stringify(result));
      return result;
    })();
  }
  standings(id: string) {
    const s = this.get(id),
      cfg = JSON.parse(s.config);
    if (cfg.leaderboard === false || s.source === "IMPORT") return null;
    return standings(this.db, id, cfg.seconds);
  }
  snapshot(id: string) {
    const s = this.get(id),
      q = this.current(id);
    // The class sees the ranking only at moments the teacher controls: revealed results or the end.
    const board =
      s.state === "FINISHED" || (q?.status === "CLOSED" && q.results_revealed)
        ? this.standings(id)
        : null;
    let question = null;
    if (q) {
      const d = JSON.parse(q.data);
      question = {
        id: q.id,
        question: d.question,
        option_a: d.option_a,
        option_b: d.option_b,
        option_c: d.option_c,
        option_d: d.option_d,
        status: q.status,
        question_order: q.question_order,
        deadline_at: q.deadline_at,
        remaining_ms: q.remaining_ms,
        results: q.status === "CLOSED" && q.results_revealed
          ? {
              counts: Object.fromEntries(
                ["A", "B", "C", "D"].map((choice) => [
                  choice,
                  one(this.db, "SELECT count(*) n FROM answers WHERE session_question_id=? AND choice=?", q.id, choice)!.n,
                ]),
              ),
              correct_answer: d.correct_answer,
            }
          : null,
      };
    }
    return {
      id: s.id,
      name: s.name,
      class_name: s.class_name,
      room_code: s.room_code,
      state: s.state,
      state_version: s.state_version,
      config: JSON.parse(s.config),
      server_time: this.now(),
      question,
      answered: q
        ? one(
            this.db,
            "SELECT count(*) n FROM answers WHERE session_question_id=?",
            q.id,
          )!.n
        : 0,
      participants: one(
        this.db,
        "SELECT count(*) n FROM session_students WHERE session_id=? AND absent=0",
        id,
      )!.n,
      leaderboard: board
        ? board.slice(0, 5).map(({ rank, name, points, last_gain, streak }) => ({
            rank,
            name,
            points,
            last_gain,
            streak,
          }))
        : null,
    };
  }
  deviceSnapshot(device: string) {
    const b = one(
      this.db,
      "SELECT b.* FROM session_devices b JOIN devices d ON d.id=b.device_id WHERE b.device_id=? AND b.active=1 AND d.revoked=0",
      device,
    );
    if (!b) return { state: "WAITING", server_time: this.now() };
    const s = this.snapshot(b.session_id);
    const a = s.question
      ? one(
          this.db,
          "SELECT choice,seq,binding_id FROM answers WHERE session_question_id=? AND session_student_id=?",
          s.question.id,
          b.session_student_id,
        )
      : null;
    return {
      id: s.id,
      state: s.state,
      state_version: s.state_version,
      server_time: s.server_time,
      binding_id: b.id,
      question: s.question
        ? {
            id: s.question.id,
            status: s.question.status,
            deadline_at: s.question.deadline_at,
            remaining_ms: s.question.remaining_ms,
          }
        : null,
      current_answer: a
        ? { choice: a.choice, seq: a.binding_id === b.id ? a.seq : 0 }
        : null,
    };
  }
  answer(device: string, input: unknown) {
    const p: AnswerPacket = answerSchema.parse(input);
    return this.db.transaction(() => {
      const ack = (code: string) => ({
        v: 1,
        type: "answer.ack",
        request_id: p.request_id,
        accepted: false,
        code,
      });
      const b = one(
        this.db,
        "SELECT b.*,s.absent,d.revoked FROM session_devices b JOIN session_students s ON s.id=b.session_student_id JOIN devices d ON d.id=b.device_id WHERE b.id=? AND b.device_id=? AND b.session_id=?",
        p.binding_id,
        device,
        p.session_id,
      );
      if (!b || b.revoked || b.absent) return ack("DEVICE_NOT_ASSIGNED");
      if (
        !b.active &&
        !["FINISHED", "CANCELLED"].includes(this.get(p.session_id).state)
      )
        return ack("DEVICE_NOT_ASSIGNED");
      const digest = hash(JSON.stringify(p));
      const old = one(
        this.db,
        "SELECT * FROM answer_receipts WHERE binding_id=? AND request_id=?",
        b.id,
        p.request_id,
      );
      if (old) {
        if (old.payload_hash !== digest) return ack("REQUEST_REUSED");
        return { ...JSON.parse(old.ack), duplicate: true };
      }
      if (!b.active) return ack("DEVICE_NOT_ASSIGNED");
      const s = this.get(p.session_id),
        q = one(
          this.db,
          "SELECT * FROM session_questions WHERE id=? AND session_id=?",
          p.question_instance_id,
          s.id,
        ),
        now = this.now();
      let result: Row;
      if (s.state === "PAUSED") result = ack("SESSION_PAUSED");
      else if (
        s.state !== "RUNNING" ||
        !q ||
        q.status !== "OPEN" ||
        q.question_order !== s.current_order ||
        now >= q.deadline_at
      )
        result = ack("QUESTION_CLOSED");
      else {
        const a = one(
          this.db,
          "SELECT * FROM answers WHERE session_question_id=? AND session_student_id=?",
          q.id,
          b.session_student_id,
        );
        if (a && a.binding_id === b.id && p.seq <= a.seq)
          result = ack("STALE_SEQUENCE");
        else if (a && !JSON.parse(s.config).allow_change)
          result = ack("ANSWER_LOCKED");
        else {
          this.db
            .prepare("INSERT OR REPLACE INTO answers VALUES (?,?,?,?,?,?,?)")
            .run(
              q.id,
              b.session_student_id,
              b.id,
              p.choice,
              p.seq,
              now,
              Math.max(0, now - q.opened_at - q.pause_ms),
            );
          result = {
            v: 1,
            type: "answer.ack",
            request_id: p.request_id,
            accepted: true,
            choice: p.choice,
            seq: p.seq,
            duplicate: false,
          };
        }
      }
      this.db
        .prepare("INSERT INTO answer_receipts VALUES (?,?,?,?,?)")
        .run(b.id, p.request_id, digest, JSON.stringify(result), now);
      this.event(
        s.id,
        result.accepted ? "answer.saved" : "answer.rejected",
        {
          student_id: b.session_student_id,
          device_id: device,
          question_id: p.question_instance_id,
          binding_id: b.id,
          request_id: p.request_id,
          choice: result.accepted ? p.choice : undefined,
          code: result.accepted ? undefined : result.code,
        },
      );
      if (result.accepted && !JSON.parse(s.config).auto_next) {
        const answered = one(
            this.db,
            "SELECT count(*) n FROM answers WHERE session_question_id=?",
            q!.id,
          )!.n,
          participants = one(
            this.db,
            "SELECT count(*) n FROM session_students WHERE session_id=? AND absent=0",
            s.id,
          )!.n;
        if (answered === participants) {
          this.closeQuestion(s.id);
          this.db
            .prepare(
              "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
            )
            .run(s.id);
        }
      }
      return result;
    })();
  }
  report(id: string) {
    const s = this.get(id),
      cfg: Config = JSON.parse(s.config),
      qs = all(
        this.db,
        "SELECT * FROM session_questions WHERE session_id=? ORDER BY question_order",
        id,
      ),
      as = all(
        this.db,
        "SELECT a.* FROM answers a JOIN session_questions q ON q.id=a.session_question_id WHERE q.session_id=?",
        id,
      ),
      events = all(
        this.db,
        "SELECT * FROM session_events WHERE session_id=? ORDER BY id",
        id,
      ),
      bindings = all(
        this.db,
        "SELECT b.*,d.label FROM session_devices b JOIN devices d ON d.id=b.device_id WHERE b.session_id=? ORDER BY b.created_at,b.rowid",
        id,
      ),
      eventRecords: Row[] = events.map((e) => ({ ...e, data: JSON.parse(e.detail) })),
      openingEvents = new Map(eventRecords.filter((e) => e.type === "question.opened").map((e) => [e.data.question_id, e])),
      closingEvents = new Map(eventRecords.filter((e) => e.type === "question.closed").map((e) => [e.data.question_id, e])),
      incidentEvents = eventRecords
        .filter((e) =>
          ["device.disconnected", "binding.changed", "answer.rejected", "server.recovered"].includes(e.type),
        ),
      scored = qs.filter((q) => q.status === "CLOSED" && !q.voided),
      N = scored.length;
    const students = all(
      this.db,
      "SELECT * FROM session_students WHERE session_id=? ORDER BY student_code",
      id,
    ).map((st) => {
      const details = qs.map((q) => {
        const a = as.find(
          (a) =>
            a.session_student_id === st.id && a.session_question_id === q.id,
        );
        const openingEvent = openingEvents.get(q.id),
          closingEvent = closingEvents.get(q.id);
        const incidents = q.opened_at == null
          ? []
          : incidentEvents.filter((e) => {
              if (openingEvent ? e.id <= openingEvent.id : e.created_at <= q.opened_at)
                return false;
              if (closingEvent ? e.id >= closingEvent.id : e.created_at >= (q.closed_at ?? this.now() + 1))
                return false;
              if (e.created_at > (q.closed_at ?? this.now()))
                return false;
              if (e.type === "server.recovered") return true;
              if (e.type === "answer.rejected")
                return e.data.student_id === st.id && e.data.question_id === q.id;
              if (e.type === "binding.changed") return e.data.student === st.id;
              const binding = bindings.find((b) =>
                b.session_student_id === st.id &&
                b.device_id === e.data.device_id &&
                b.created_at <= e.created_at,
              );
              return !!binding && !incidentEvents.some((later) =>
                later.type === "binding.changed" &&
                later.data.student === st.id &&
                later.created_at > binding.created_at &&
                later.created_at <= e.created_at &&
                later.data.device !== binding.device_id,
              );
            }).map((e) => ({ id: e.id, type: e.type, created_at: e.created_at, code: e.data.code }));
        return {
          question_id: q.id,
          order: q.question_order,
          choice: a?.choice ?? null,
          correct_answer: JSON.parse(q.data).correct_answer,
          response_ms: s.source === "IMPORT" ? null : a?.response_ms ?? null,
          received_at: a?.received_at ?? null,
          binding_id: a?.binding_id ?? null,
          device_label: bindings.find((b) => b.id === a?.binding_id)?.label ?? null,
          status: q.status,
          voided: !!q.voided,
          opened_at: q.opened_at,
          closed_at: q.closed_at,
          incidents,
          scored: q.status === "CLOSED" && !q.voided,
        };
      });
      const counted = details.filter((d) => d.scored),
        C = counted.filter((d) => d.choice === d.correct_answer).length,
        W = counted.filter(
          (d) => d.choice && d.choice !== d.correct_answer,
        ).length,
        U = N - C - W,
        score =
          st.absent || !N || s.state === "CANCELLED" ? null : (C / N) * 10,
        times = counted
          .filter((d) => d.response_ms != null)
          .map((d) => d.response_ms as number);
      return {
        ...st,
        absent: st.absent,
        C: st.absent ? 0 : C,
        W: st.absent ? 0 : W,
        U: st.absent ? 0 : U,
        score,
        correct_rate: score == null ? null : (C / N) * 100,
        answer_rate: score == null ? null : ((C + W) / N) * 100,
        passed: score == null ? null : score >= cfg.pass_mark,
        response_ms: s.source === "IMPORT"
          ? null
          : times.length
          ? times.reduce((a, b) => a + b, 0) / times.length
          : null,
        details,
      };
    });
    const scores = students
        .filter((s) => s.score != null)
        .map((s) => s.score as number)
        .sort((a, b) => a - b),
      participants = students.filter((s) => !s.absent).length;
    return {
      session: { ...s, config: cfg },
      N,
      leaderboard: s.state === "CANCELLED" ? null : this.standings(id),
      students,
      questions: qs.map((q) => {
        const data = JSON.parse(q.data),
          answers = as.filter((a) => a.session_question_id === q.id);
        return {
          ...q,
          data,
          counts: Object.fromEntries(
            ["A", "B", "C", "D"].map((c) => [
              c,
              answers.filter((a) => a.choice === c).length,
            ]),
          ),
          blank: q.status === "PENDING" ? null : participants - answers.length,
          correct_rate:
            participants && q.status !== "PENDING"
              ? (answers.filter((a) => a.choice === data.correct_answer)
                  .length /
                  participants) *
                100
              : null,
          response_ms: answers.length
            ? answers.reduce((sum, a) => sum + a.response_ms, 0) /
              answers.length
            : null,
        };
      }),
      stats: {
        participants,
        complete: N
          ? students.filter((s) => !s.absent && s.C + s.W === N).length
          : 0,
        mean: scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : null,
        median: scores.length
          ? (scores[Math.floor((scores.length - 1) / 2)] +
              scores[Math.floor(scores.length / 2)]) /
            2
          : null,
        min: scores[0] ?? null,
        max: scores.at(-1) ?? null,
        pass_rate: scores.length
          ? (scores.filter((n) => n >= cfg.pass_mark).length / scores.length) *
            100
          : null,
        distribution: [0, 2, 4, 6, 8].map(
          (n, i) =>
            scores.filter((v) => v >= n && (i === 4 ? v <= 10 : v < n + 2))
              .length,
        ),
      },
      events,
    };
  }
}
