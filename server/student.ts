import { Router, type Request, type RequestHandler } from "express";
import session from "express-session";
import { z } from "zod";
import { studentCodeSchema } from "../shared/student-code.js";
import { SqliteStore, token, hash } from "./auth.js";
import { one, AppError, type DB, type Row } from "./db.js";
import type { AppConfig } from "./app.js";
import type { Pairing, joinSchema } from "./pairing.js";
import type { Quiz } from "./quiz.js";

export type StudentIdentity = {
  device_id: string;
  session_id: string;
  binding_id: string;
  student_code: string;
  room_code: string;
};
declare module "express-session" {
  interface SessionData {
    studentCsrf: string;
    student: StudentIdentity;
    studentJoin: z.infer<typeof joinSchema>;
    studentDevice: { id: string; secret: string; student_code: string };
  }
}

// A browser grant follows this exact binding, never another student assigned to the device.
export function studentBinding(db: DB, identity: StudentIdentity) {
  return one(db, `SELECT b.*,st.student_code,st.full_name,s.state,s.owner_teacher_id
    FROM session_devices b JOIN session_students st ON st.id=b.session_student_id
    JOIN quiz_sessions s ON s.id=b.session_id JOIN devices d ON d.id=b.device_id
    JOIN room_devices m ON m.session_id=b.session_id AND m.device_id=b.device_id
    WHERE b.id=? AND b.device_id=? AND b.session_id=? AND st.student_code=?
      AND st.absent=0 AND d.revoked=0 AND (b.active=1 OR s.state='CANCELLED'
      OR (s.state='FINISHED' AND EXISTS(SELECT 1 FROM session_events e
        WHERE e.session_id=b.session_id AND e.type='device.result'
        AND json_extract(e.detail,'$.binding_id')=b.id)))`,
    identity.binding_id, identity.device_id, identity.session_id, identity.student_code);
}

export function studentSnapshot(db: DB, quiz: Quiz, identity: StudentIdentity) {
  const binding = studentBinding(db, identity);
  if (!binding) throw new AppError("STUDENT_ACCESS_ENDED", "Bạn không còn trong phòng này hoặc quyền làm bài đã hết. Hãy hỏi giáo viên.", 401);
  const s = quiz.get(identity.session_id), config = JSON.parse(s.config);
  const q = quiz.current(s.id);
  const question = q ? JSON.parse(q.data) : null;
  const answer = q && one(db, "SELECT choice,seq,binding_id FROM answers WHERE session_question_id=? AND session_student_id=?", q.id, binding.session_student_id);
  let result = null;
  if (s.state === "FINISHED") {
    const report = quiz.report(s.id).students.find(st => (st as Row).id === binding.session_student_id);
    if (report) result = { correct: report.C, total: report.details.filter(q => q.scored).length, score: report.score };
  }
  return {
    id: s.id, name: s.name, class_name: s.class_name,
    student_code: binding.student_code, full_name: binding.full_name,
    state: s.state, state_version: s.state_version, server_time: quiz.now(),
    binding_id: binding.id, total_questions: config.count,
    seconds_per_question: config.seconds, allow_change: config.allow_change, result,
    question: q ? {
      id: q.id, question_order: q.question_order, status: q.status,
      deadline_at: q.deadline_at, remaining_ms: q.remaining_ms,
      question: question.question, option_a: question.option_a,
      option_b: question.option_b, option_c: question.option_c, option_d: question.option_d,
    } : null,
    current_answer: answer ? { choice: answer.choice, seq: answer.binding_id === binding.id ? answer.seq : 0 } : null,
  };
}

const inputSchema = z.object({
  student_code: studentCodeSchema,
  room_code: z.string().transform(s => s.replace(/\s/g, "")).pipe(z.string().regex(/^\d{8}$/)),
  request_id: z.string().uuid(),
}).strict();
const save = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));

export function createStudentPortal(db: DB, config: AppConfig, quiz: Quiz, pairing: Pairing,
  limitJoin: (req: Request) => void, changed: () => void) {
  // Independent cookie: a student's browser does not inherit or replace a teacher login.
  const auth: RequestHandler = session({
    name: "classroom.student.sid", secret: config.secret, resave: false,
    saveUninitialized: false, store: new SqliteStore(db),
    cookie: { httpOnly: true, sameSite: "strict", secure: config.production, maxAge: 86400000 },
  });
  const router = Router();
  router.use(auth);
  router.use((req, _res, next) => {
    if (config.production && !req.secure)
      return next(new AppError("HTTPS_REQUIRED", "Trang làm bài cần kết nối HTTPS", 403));
    if (req.method !== "GET" && (!req.session.studentCsrf || req.get("X-CSRF-Token") !== req.session.studentCsrf))
      return next(new AppError("CSRF", "Phiên thao tác đã hết hạn; tải lại trang", 403));
    next();
  });
  const identity = (req: Request) => {
    const student = req.session.student;
    if (!student || !studentBinding(db, student))
      throw new AppError("STUDENT_ACCESS_ENDED", "Bạn không còn trong phòng này hoặc quyền làm bài đã hết. Hãy hỏi giáo viên.", 401);
    return student;
  };
  router.get("/session", async (req, res) => {
    req.session.studentCsrf ||= token();
    const student = req.session.student;
    const valid = student && studentBinding(db, student);
    await save(req);
    res.json({ csrf: req.session.studentCsrf,
      student: valid ? student : null,
      snapshot: valid ? studentSnapshot(db, quiz, student) : null,
      pending: req.session.studentJoin ? {
        student_code: req.session.studentJoin.student_code,
        room_code: req.session.studentJoin.room_code,
        request_id: req.session.studentJoin.request_id,
      } : null,
      access_ended: !!student && !valid,
    });
  });
  router.post("/join", async (req, res) => {
    limitJoin(req);
    const input = inputSchema.parse(req.body);
    const old = req.session.student;
    if (old && studentBinding(db, old) && !["FINISHED", "CANCELLED"].includes(quiz.get(old.session_id).state)) {
      if (old.student_code === input.student_code && old.room_code === input.room_code)
        return res.json({ student: old, duplicate: true });
      throw new AppError("STUDENT_BUSY", "Bạn đang ở một phòng kiểm tra. Hãy chờ kết thúc hoặc nhờ giáo viên gỡ ghép.", 409);
    }
    let packet = req.session.studentJoin;
    if (packet && (packet.request_id !== input.request_id || packet.room_code !== input.room_code || packet.student_code !== input.student_code))
      throw new AppError("STUDENT_JOIN_PENDING", "Yêu cầu vào phòng trước chưa rõ kết quả. Hãy gửi lại yêu cầu đó.", 409);
    if (!packet) {
      const previous = req.session.studentDevice;
      const room = one(db, "SELECT s.owner_teacher_id FROM room_pairing p JOIN quiz_sessions s ON s.id=p.session_id WHERE p.room_code=?", input.room_code);
      const reusable = previous && previous.student_code === input.student_code &&
        one(db, "SELECT 1 FROM devices WHERE id=? AND owner_teacher_id=? AND revoked=0", previous.id, room?.owner_teacher_id ?? "");
      packet = {
        v: 1, ...input, device_name: `Web ${input.student_code}`,
        device_secret: reusable ? previous.secret : token(),
        ...(reusable ? { device_id: previous.id } : {}),
      };
      req.session.studentJoin = packet;
      // Persist the exact credentials BEFORE joining; lost responses/restarts retry the same transaction.
      await save(req);
    }
    let joined;
    try {
      joined = pairing.join(packet, undefined, { browser: true });
    } catch (e) {
      if (e instanceof AppError && e.status < 500) {
        delete req.session.studentJoin;
        await save(req);
      }
      throw e;
    }
    const binding = one(db, `SELECT b.id FROM session_devices b JOIN session_students st ON st.id=b.session_student_id
      WHERE b.session_id=? AND b.device_id=? AND st.student_code=? ORDER BY b.rowid DESC LIMIT 1`,
      joined.session_id, joined.device_id, input.student_code);
    if (!binding) throw new AppError("STUDENT_ACCESS_ENDED", "Học sinh chưa được ghép hoặc đã bị gỡ khỏi phòng", 409);
    const student = { device_id: joined.device_id, session_id: joined.session_id,
      binding_id: binding.id, student_code: input.student_code, room_code: input.room_code };
    if (!studentBinding(db, student))
      throw new AppError("STUDENT_ACCESS_ENDED", "Học sinh đã bị gỡ ghép khỏi phòng", 409);
    req.session.student = student;
    req.session.studentDevice = { id: joined.device_id, secret: packet.device_secret, student_code: input.student_code };
    delete req.session.studentJoin;
    await save(req);
    changed();
    res.status(joined.duplicate ? 200 : 201).json({ student, duplicate: joined.duplicate });
  });
  router.post("/ticket", (req, res) => {
    const student = identity(req), binding = studentBinding(db, student)!;
    const value = token();
    db.prepare("DELETE FROM access_tokens WHERE kind='student' AND auth_sid=?").run(req.sessionID);
    db.prepare("INSERT INTO access_tokens VALUES (?,?,?,?,?,?,0)").run(
      hash(value), "student", student.device_id, binding.owner_teacher_id, req.sessionID, Date.now() + 60000);
    res.json({ ticket: value });
  });
  router.post("/leave", async (req, res) => {
    const student = req.session.student;
    if (student && studentBinding(db, student) && !["FINISHED", "CANCELLED"].includes(quiz.get(student.session_id).state))
      throw new AppError("STUDENT_BUSY", "Chờ bài kết thúc hoặc nhờ giáo viên gỡ bạn khỏi phòng trước khi rời.", 409);
    if (req.session.studentJoin)
      throw new AppError("STUDENT_JOIN_PENDING", "Hãy gửi lại yêu cầu vào phòng để xác định kết quả trước.", 409);
    delete req.session.student;
    db.prepare("DELETE FROM access_tokens WHERE kind='student' AND auth_sid=?").run(req.sessionID);
    await save(req);
    changed();
    res.json({ ok: true });
  });
  router.use((_req, _res, next) => next(new AppError("NOT_FOUND", "Không tìm thấy API học sinh", 404)));
  return { router, auth };
}
