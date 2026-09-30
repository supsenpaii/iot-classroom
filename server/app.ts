import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import { createServer } from "node:http";
import { randomInt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import { type DB, type Row, all, one, owned, must, AppError } from "./db.js";
import {
  SqliteStore,
  passwordHash,
  verifyPassword,
  token,
  hash,
  revokeTeacher,
} from "./auth.js";
import { Quiz } from "./quiz.js";
import {
  preview,
  previewResults,
  template,
  studentSchema,
  reportExcel,
} from "./imports.js";
import { questionSchema, configSchema } from "../shared/protocol.js";
import { attachRealtime } from "./realtime.js";
import { createStudyGuide } from "./study-guide.js";
export type AppConfig = {
  origin: string;
  secret: string;
  production: boolean;
  simulator: boolean;
  trustProxy: number;
  maxUpload: number;
  geminiApiKey: string;
  geminiModel: string;
};
const nameSchema = z.string().trim().min(1).max(150);
export function createApplication(db: DB, config: AppConfig) {
  const app = express(),
    server = createServer(app),
    quiz = new Quiz(db);
  quiz.recover();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  const auth = session({
    name: "classroom.sid",
    secret: config.secret,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore(db),
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: config.production,
      maxAge: 86400000,
    },
  });
  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (config.production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  app.get("/health/ready", (_req, res) => {
    db.prepare("SELECT 1 FROM migrations").get();
    res.json({ ok: true });
  });
  app.use(auth);
  app.use(express.json({ limit: "3mb" }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("Origin") !== config.origin
    )
      return next(
        new AppError("BAD_ORIGIN", "Nguồn yêu cầu không hợp lệ", 403),
      );
    next();
  });
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const studyGuideInFlight = new Set<string>();
  let loginInFlight = 0;
  app.post("/api/auth/login", async (req, res) => {
    const key = req.ip || "unknown",
      now = Date.now();
    let rate = loginAttempts.get(key);
    if (!rate || rate.until < now) {
      rate = { count: 0, until: now + 15 * 60000 };
      loginAttempts.set(key, rate);
    }
    if (++rate.count > 20 || loginInFlight >= 4)
      throw new AppError(
        "RATE_LIMIT",
        "Thử đăng nhập quá nhiều; vui lòng thử lại sau",
        429,
      );
    const input = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const t = one(
      db,
      "SELECT * FROM teachers WHERE email=?",
      input.email.toLowerCase(),
    );
    loginInFlight++;
    let valid: boolean;
    try {
      valid = await verifyPassword(
        input.password,
        t?.password_hash ?? "scrypt:16384:8:1:dummy:" + "00".repeat(64),
      );
    } finally {
      loginInFlight--;
    }
    if (
      !t ||
      !valid ||
      one(db, "SELECT password_hash FROM teachers WHERE id=?", t.id)
        ?.password_hash !== t.password_hash
    )
      throw new AppError("BAD_LOGIN", "Email hoặc mật khẩu chưa đúng", 401);
    await new Promise<void>((done, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : done())),
    );
    req.session.teacherId = t.id;
    req.session.csrf = token();
    res.json({
      id: t.id,
      email: t.email,
      csrf: req.session.csrf,
      simulator: config.simulator,
    });
  });
  const issue = (
    kind: string,
    resource: string,
    req: Request,
    ttl = 3600000,
  ) => {
    const value = token();
    db.prepare("INSERT INTO access_tokens VALUES (?,?,?,?,?,?,0)").run(
      hash(value),
      kind,
      resource,
      req.session.teacherId,
      req.sessionID,
      Date.now() + ttl,
    );
    return value;
  };
  app.post("/api/presentation/exchange", (req, res) => {
    const value = z.string().length(64).parse(req.body.token);
    const grant = db.transaction(() => {
      const r = must(
        one(
          db,
          "SELECT * FROM access_tokens WHERE hash=? AND kind='projection-bootstrap' AND used=0 AND expires>?",
          hash(value),
          Date.now(),
        ),
      );
      if (
        !one(
          db,
          "SELECT 1 FROM auth_sessions WHERE sid=? AND expires>?",
          r.auth_sid,
          Date.now(),
        )
      )
        throw new AppError("EXPIRED", "Quyền đã hết hạn", 401);
      db.prepare("UPDATE access_tokens SET used=1 WHERE hash=?").run(r.hash);
      const access = token();
      db.prepare("INSERT INTO access_tokens VALUES (?,?,?,?,?,?,0)").run(
        hash(access),
        "projection",
        r.resource_id,
        r.owner_teacher_id,
        r.auth_sid,
        Date.now() + 4 * 3600000,
      );
      return { token: access, session_id: r.resource_id };
    })();
    res.json(grant);
  });
  app.use("/api", (req, _res, next) => {
    if (!req.session.teacherId)
      return next(new AppError("UNAUTHENTICATED", "Vui lòng đăng nhập", 401));
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-CSRF-Token") !== req.session.csrf
    )
      return next(
        new AppError("CSRF", "Phiên thao tác đã hết hạn; tải lại trang", 403),
      );
    next();
  });
  const owner = (req: Request) => req.session.teacherId!;
  const param = (req: Request, key = "id") => String(req.params[key]);
  const realtime = attachRealtime(server, db, quiz, auth, config);
  const changed = () => realtime.schedule();
  app.get("/api/auth/me", (req, res) => {
    const t = must(
      one(db, "SELECT id,email FROM teachers WHERE id=?", owner(req)),
    );
    res.json({ ...t, csrf: req.session.csrf, simulator: config.simulator });
  });
  app.post("/api/auth/logout", (req, res, next) => {
    const sid = req.sessionID;
    db.prepare("DELETE FROM access_tokens WHERE auth_sid=?").run(sid);
    req.session.destroy((e) => {
      realtime.revalidate();
      if (e) next(e);
      else {
        res.clearCookie("classroom.sid");
        res.json({ ok: true });
      }
    });
  });
  app.post("/api/auth/change-password", async (req, res) => {
    const input = z
      .object({
        current: z.string().max(200),
        password: z.string().min(12).max(200),
      })
      .parse(req.body);
    const t = must(one(db, "SELECT * FROM teachers WHERE id=?", owner(req)));
    if (!(await verifyPassword(input.current, t.password_hash)))
      throw new AppError("BAD_PASSWORD", "Mật khẩu hiện tại chưa đúng");
    const next = await passwordHash(input.password);
    db.transaction(() => {
      db.prepare("UPDATE teachers SET password_hash=? WHERE id=?").run(
        next,
        t.id,
      );
      revokeTeacher(db, t.id);
    })();
    req.session.destroy(() => {});
    realtime.revalidate();
    res.json({ ok: true });
  });
  app.get("/api/classes", (req, res) =>
    res.json(
      all(
        db,
        "SELECT c.*,(SELECT count(*) FROM students WHERE class_id=c.id) student_count FROM classes c WHERE owner_teacher_id=? ORDER BY rowid DESC",
        owner(req),
      ),
    ),
  );
  app.post("/api/classes", (req, res) => {
    const name = nameSchema.parse(req.body.name),
      id = randomUUID();
    db.prepare(
      "INSERT INTO classes(id,owner_teacher_id,name) VALUES (?,?,?)",
    ).run(id, owner(req), name);
    res.status(201).json({ id });
  });
  app.get("/api/classes/:id", (req, res) => {
    const c = owned(db, "classes", param(req), owner(req));
    res.json({
      ...c,
      students: all(
        db,
        "SELECT * FROM students WHERE class_id=? ORDER BY student_code",
        c.id,
      ),
      sessions: all(
        db,
        "SELECT id,name,state,created_at FROM quiz_sessions WHERE class_id=? AND owner_teacher_id=? ORDER BY created_at DESC",
        c.id,
        owner(req),
      ),
    });
  });
  app.patch("/api/classes/:id", (req, res) => {
    const c = owned(db, "classes", param(req), owner(req));
    const input = z
      .object({ name: nameSchema, archived: z.boolean() })
      .parse(req.body);
    db.prepare("UPDATE classes SET name=?,archived=? WHERE id=?").run(
      input.name,
      +input.archived,
      c.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/classes/:id/students/import", (req, res) => {
    const c = owned(db, "classes", param(req), owner(req)),
      rows = z.array(studentSchema).min(1).max(500).parse(req.body.rows);
    if (new Set(rows.map((s) => s.student_code)).size !== rows.length)
      throw new AppError("DUPLICATE_CODE", "Mã học sinh bị trùng trong file");
    db.transaction(() => {
      for (const s of rows)
        db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(
          randomUUID(),
          c.id,
          s.student_code,
          s.full_name,
        );
    })();
    res.json({ count: rows.length });
  });
  app.patch("/api/classes/:id/students/:student", (req, res) => {
    owned(db, "classes", param(req), owner(req));
    const input = studentSchema.parse(req.body);
    if (
      !db
        .prepare(
          "UPDATE students SET student_code=?,full_name=? WHERE id=? AND class_id=?",
        )
        .run(
          input.student_code,
          input.full_name,
          param(req, "student"),
          param(req),
        ).changes
    )
      throw new AppError("NOT_FOUND", "Không tìm thấy học sinh", 404);
    res.json({ ok: true });
  });
  app.delete("/api/classes/:id/students/:student", (req, res) => {
    owned(db, "classes", param(req), owner(req));
    db.prepare("DELETE FROM students WHERE id=? AND class_id=?").run(
      param(req, "student"),
      param(req),
    );
    res.json({ ok: true });
  });
  app.get("/api/question-banks", (req, res) =>
    res.json(
      all(
        db,
        "SELECT b.*,(SELECT count(*) FROM questions WHERE bank_id=b.id) question_count FROM question_banks b WHERE owner_teacher_id=? ORDER BY rowid DESC",
        owner(req),
      ),
    ),
  );
  app.post("/api/question-banks", (req, res) => {
    const input = z
        .object({
          name: nameSchema,
          subject: z.string().trim().max(100).default(""),
        })
        .parse(req.body),
      id = randomUUID();
    db.prepare("INSERT INTO question_banks VALUES (?,?,?,?)").run(
      id,
      owner(req),
      input.name,
      input.subject,
    );
    res.status(201).json({ id });
  });
  app.get("/api/question-banks/:id", (req, res) => {
    const b = owned(db, "question_banks", param(req), owner(req));
    res.json({
      ...b,
      questions: all(
        db,
        "SELECT * FROM questions WHERE bank_id=? ORDER BY rowid",
        b.id,
      ).map((q) => ({ id: q.id, ...JSON.parse(q.data) })),
    });
  });
  app.patch("/api/question-banks/:id", (req, res) => {
    owned(db, "question_banks", param(req), owner(req));
    const input = z
      .object({ name: nameSchema, subject: z.string().max(100) })
      .parse(req.body);
    db.prepare("UPDATE question_banks SET name=?,subject=? WHERE id=?").run(
      input.name,
      input.subject,
      param(req),
    );
    res.json({ ok: true });
  });
  app.post("/api/question-banks/:id/questions", (req, res) => {
    owned(db, "question_banks", param(req), owner(req));
    const input = questionSchema.parse(req.body),
      id = randomUUID();
    db.prepare("INSERT INTO questions VALUES (?,?,?)").run(
      id,
      param(req),
      JSON.stringify(input),
    );
    res.status(201).json({ id });
  });
  for (const method of ["patch", "delete"] as const)
    app[method]("/api/questions/:id", (req, res) => {
      const q = must(
        one(
          db,
          "SELECT q.* FROM questions q JOIN question_banks b ON b.id=q.bank_id WHERE q.id=? AND b.owner_teacher_id=?",
          param(req),
          owner(req),
        ),
      );
      if (method === "delete")
        db.prepare("DELETE FROM questions WHERE id=?").run(q.id);
      else
        db.prepare("UPDATE questions SET data=? WHERE id=?").run(
          JSON.stringify(questionSchema.parse(req.body)),
          q.id,
        );
      res.json({ ok: true });
    });
  app.get("/api/templates/:kind.:format", async (req, res) => {
    const kind = z.enum(["questions", "students", "results"]).parse(req.params.kind),
      format = z.enum(["csv", "xlsx"]).parse(req.params.format),
      questionCount =
        kind === "results"
          ? z.coerce.number().int().min(1).max(100).default(3).parse(req.query.count)
          : 3;
    res
      .type(
        format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .attachment(`${kind}.${format}`)
      .send(await template(kind, format, questionCount));
  });
  let parsing = false;
  app.post(
    "/api/imports/:kind/preview",
    express.raw({ type: "application/octet-stream", limit: config.maxUpload }),
    async (req, res) => {
      const kind = z.enum(["questions", "students", "results"]).parse(req.params.kind);
      if (!Buffer.isBuffer(req.body))
        throw new AppError("INVALID_FILE", "Gửi nội dung file");
      if (parsing)
        throw new AppError(
          "IMPORT_BUSY",
          "Một file khác đang được đọc; thử lại sau",
          429,
        );
      parsing = true;
      try {
        const name = decodeURIComponent(req.get("X-Filename") || "");
        res.json(
          kind === "results"
            ? await previewResults(req.body, name)
            : await preview(req.body, name, kind),
        );
      } finally {
        parsing = false;
      }
    },
  );
  app.post("/api/imports/questions/commit", (req, res) => {
    const bank = z.string().parse(req.body.bank_id);
    owned(db, "question_banks", bank, owner(req));
    const rows = z.array(questionSchema).min(1).max(500).parse(req.body.rows);
    db.transaction(() => {
      for (const q of rows)
        db.prepare("INSERT INTO questions VALUES (?,?,?)").run(
          randomUUID(),
          bank,
          JSON.stringify(q),
        );
    })();
    res.json({ count: rows.length });
  });
  app.get("/api/devices", (req, res) =>
    res.json(
      all(
        db,
        "SELECT d.id,d.label,d.revoked,d.last_seen,(SELECT b.session_id FROM session_devices b WHERE b.device_id=d.id AND b.active=1) assigned_session,EXISTS(SELECT 1 FROM session_devices b WHERE b.device_id=d.id) used FROM devices d WHERE d.owner_teacher_id=? ORDER BY d.label",
        owner(req),
      ).map((d) => ({ ...d, online: !d.revoked && realtime.online(d.id) })),
    ),
  );
  app.post("/api/devices", (req, res) => {
    const label = nameSchema.parse(req.body.label),
      id = randomUUID(),
      secret = token();
    if (one(db, "SELECT 1 FROM devices WHERE owner_teacher_id=? AND revoked=0 AND lower(label)=lower(?)", owner(req), label))
      throw new AppError("DUPLICATE_LABEL", "Nhãn thiết bị đang được sử dụng", 409);
    db.prepare(
      "INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)",
    ).run(id, owner(req), label, hash(secret));
    res.status(201).json({ id, label, secret });
  });
  app.post("/api/devices/:id/:action", (req, res) => {
    const d = owned(db, "devices", param(req), owner(req));
    switch (req.params.action) {
      case "rotate-secret": {
        if (d.revoked && one(db, "SELECT 1 FROM devices WHERE owner_teacher_id=? AND id<>? AND revoked=0 AND lower(label)=lower(?)", owner(req), d.id, d.label))
          throw new AppError("DUPLICATE_LABEL", "Nhãn thiết bị đang được sử dụng", 409);
        const secret = token();
        db.prepare("UPDATE devices SET secret_hash=?,revoked=0 WHERE id=?").run(
          hash(secret),
          d.id,
        );
        db.prepare(
          "DELETE FROM access_tokens WHERE resource_id=? AND kind='simulator'",
        ).run(d.id);
        realtime.disconnectDevice(d.id);
        res.json({ id: d.id, secret });
        break;
      }
      case "revoke":
        db.transaction(() => {
          const sessions = all(db, "SELECT DISTINCT session_id FROM session_devices WHERE device_id=? AND active=1", d.id);
          db.prepare("UPDATE devices SET revoked=1 WHERE id=?").run(d.id);
          db.prepare("UPDATE session_devices SET active=0 WHERE device_id=? AND active=1").run(d.id);
          db.prepare("DELETE FROM access_tokens WHERE resource_id=? AND kind='simulator'").run(d.id);
          for (const s of sessions) {
            db.prepare("UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?").run(s.session_id);
            quiz.event(s.session_id, "binding.changed", { device: null }, owner(req));
          }
        })();
        realtime.disconnectDevice(d.id);
        res.json({ ok: true });
        break;
      case "ticket":
        if (!config.simulator || d.revoked)
          throw new AppError(
            "SIMULATOR_DISABLED",
            "Giả lập không khả dụng",
            403,
          );
        res.json({ ticket: issue("simulator", d.id, req, 60000) });
        break;
      default:
        throw new AppError("NOT_FOUND", "Không tìm thấy thao tác", 404);
    }
    changed();
  });
  app.delete("/api/devices/:id", (req, res) => {
    const d = owned(db, "devices", param(req), owner(req));
    if (one(db, "SELECT 1 FROM session_devices WHERE device_id=?", d.id))
      throw new AppError("DEVICE_HAS_HISTORY", "Thiết bị đã dùng trong buổi học; hãy thu hồi để giữ lịch sử", 409);
    db.transaction(() => {
      db.prepare("DELETE FROM access_tokens WHERE resource_id=? AND kind='simulator'").run(d.id);
      db.prepare("DELETE FROM devices WHERE id=?").run(d.id);
    })();
    realtime.disconnectDevice(d.id);
    res.json({ ok: true });
    changed();
  });
  app.get("/api/sessions", (req, res) =>
    res.json(
      all(
        db,
        "SELECT id,name,class_name,state,created_at,finished_at FROM quiz_sessions WHERE owner_teacher_id=? ORDER BY created_at DESC",
        owner(req),
      ),
    ),
  );
  app.post("/api/sessions", (req, res) => {
    const input = z
      .object({
        class_id: z.string(),
        bank_id: z.string(),
        name: nameSchema,
        config: configSchema,
      })
      .parse(req.body);
    res.status(201).json({ id: quiz.create(owner(req), input) });
  });
  app.post("/api/imports/results/commit", (req, res) => {
    const input = z
      .object({
        name: nameSchema,
        bank_id: z.string().min(1),
        pass_mark: z.number().min(0).max(10),
        answer_key: z.array(z.enum(["A", "B", "C", "D"])).min(1).max(100),
        students: z
          .array(
            z.object({
              student_code: z.string().trim().min(1).max(50),
              full_name: z.string().trim().min(1).max(150),
              answers: z.array(z.enum(["A", "B", "C", "D"]).nullable()).max(100),
            }).strict(),
          )
          .min(1)
          .max(500),
        class: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("existing"), class_id: z.string().min(1) }).strict(),
          z.object({ mode: z.literal("new"), name: nameSchema }).strict(),
        ]),
      })
      .strict()
      .parse(req.body);
    const bank = owned(db, "question_banks", input.bank_id, owner(req)),
      bankQuestions = all(db, "SELECT * FROM questions WHERE bank_id=? ORDER BY rowid", bank.id);
    if (bankQuestions.length !== input.answer_key.length)
      throw new AppError("QUESTION_COUNT_MISMATCH", "Số cột Q trong file phải khớp số câu của bộ đề.", 422);
    const questions = bankQuestions.map((row) => JSON.parse(row.data));
    if (questions.some((question, i) => question.correct_answer !== input.answer_key[i]))
      throw new AppError("ANSWER_KEY_MISMATCH", "Đáp án đúng trong file không khớp bộ đề đã chọn.", 422);
    if (input.students.some((student) => student.answers.length !== questions.length))
      throw new AppError("QUESTION_COUNT_MISMATCH", "Số đáp án mỗi học sinh phải khớp số câu của bộ đề.", 422);
    if (new Set(input.students.map((student) => student.student_code.toLocaleLowerCase())).size !== input.students.length)
      throw new AppError("DUPLICATE_CODE", "Mã học sinh bị trùng trong file.");

    const importedAt = Date.now(),
      sessionId = randomUUID(),
      questionIds = questions.map(() => randomUUID()),
      studentCodeSet = new Set(input.students.map((student) => student.student_code.toLocaleLowerCase())),
      sessionConfig = {
        count: questions.length,
        seconds: 30,
        random: false,
        auto_next: false,
        allow_change: false,
        pass_mark: input.pass_mark,
      };
    db.transaction(() => {
      let classId: string,
        className: string,
        roster: Row[];
      if (input.class.mode === "existing") {
        const cls = owned(db, "classes", input.class.class_id, owner(req));
        classId = cls.id;
        className = cls.name;
        roster = all(db, "SELECT * FROM students WHERE class_id=?", classId);
        const rosterCodes = new Set<string>();
        for (const student of roster) {
          const code = String(student.student_code).toLocaleLowerCase();
          if (rosterCodes.has(code))
            throw new AppError(
              "AMBIGUOUS_STUDENT_CODE",
              `Lớp có mã học sinh trùng khác chữ hoa/thường: ${student.student_code}.`,
              409,
            );
          rosterCodes.add(code);
        }
        const missing = input.students.find((student) => !rosterCodes.has(student.student_code.toLocaleLowerCase()));
        if (missing)
          throw new AppError("STUDENT_NOT_IN_CLASS", `Không tìm thấy mã học sinh ${missing.student_code} trong lớp đã chọn.`, 422);
      } else {
        classId = randomUUID();
        className = input.class.name;
        db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run(classId, owner(req), className);
        for (const student of input.students)
          db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(randomUUID(), classId, student.student_code, student.full_name);
        roster = all(db, "SELECT * FROM students WHERE class_id=?", classId);
      }

      db.prepare(
        "INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,current_order,created_at,finished_at,source) VALUES (?,?,?,?,?,?,?,?,'FINISHED',?,?,?,'IMPORT')",
      ).run(sessionId, owner(req), classId, bank.id, className, input.name, String(randomInt(100000, 1000000)), JSON.stringify(sessionConfig), questions.length, importedAt, importedAt);

      const uploadedByCode = new Map(input.students.map((student) => [student.student_code.toLocaleLowerCase(), student]));
      const sessionStudentIds = new Map<string, string>();
      for (const student of roster) {
        const sessionStudentId = randomUUID(),
          present = studentCodeSet.has(String(student.student_code).toLocaleLowerCase());
        sessionStudentIds.set(String(student.student_code).toLocaleLowerCase(), sessionStudentId);
        db.prepare("INSERT INTO session_students(id,session_id,student_id,student_code,full_name,absent) VALUES (?,?,?,?,?,?)")
          .run(sessionStudentId, sessionId, student.id, student.student_code, student.full_name, present ? 0 : 1);
      }
      questions.forEach((question, index) => {
        db.prepare("INSERT INTO session_questions(id,session_id,question_order,data,status,opened_at,closed_at,pause_ms) VALUES (?,?,?,?,'CLOSED',?,?,0)")
          .run(questionIds[index], sessionId, index + 1, JSON.stringify(question), importedAt, importedAt);
      });
      for (const [code, student] of uploadedByCode) {
        const sessionStudentId = sessionStudentIds.get(code);
        if (!sessionStudentId)
          throw new AppError("STUDENT_NOT_IN_CLASS", `Không tìm thấy mã học sinh ${student.student_code} trong lớp đã chọn.`, 422);
        student.answers.forEach((choice, index) => {
          if (choice)
            db.prepare("INSERT INTO answers VALUES (?,?,NULL,?,?,?,0)")
              .run(questionIds[index], sessionStudentId, choice, 1, importedAt);
        });
      }
      quiz.event(sessionId, "results.imported", {
        students: input.students.length,
        questions: questions.length,
      }, owner(req));
    })();
    res.status(201).json({ id: sessionId });
  });
  app.get("/api/sessions/:id", (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    res.json(realtime.teacherSnapshot(param(req)));
  });
  app.patch("/api/sessions/:id", (req, res) => {
    const s = owned(db, "quiz_sessions", param(req), owner(req));
    if (s.state !== "LOBBY")
      throw new AppError("LOCKED", "Cấu hình đã khóa", 409);
    const input = z
      .object({
        name: nameSchema,
        config: configSchema,
        expected_version: z.number().int(),
      })
      .parse(req.body);
    if (input.expected_version !== s.state_version)
      throw new AppError("VERSION_CONFLICT", "Cấu hình đã thay đổi", 409);
    quiz.validateCount(s.bank_id, input.config.count);
    db.prepare(
      "UPDATE quiz_sessions SET name=?,config=?,state_version=state_version+1 WHERE id=?",
    ).run(input.name, JSON.stringify(input.config), s.id);
    res.json({ ok: true });
    changed();
  });
  app.patch("/api/sessions/:id/students/:student", (req, res) => {
    const s = owned(db, "quiz_sessions", param(req), owner(req));
    if (s.state !== "LOBBY")
      throw new AppError("LOCKED", "Danh sách dự thi đã khóa", 409);
    const absent = z.boolean().parse(req.body.absent);
    const st = must(
      one(
        db,
        "SELECT * FROM session_students WHERE id=? AND session_id=?",
        param(req, "student"),
        s.id,
      ),
    );
    db.transaction(() => {
      db.prepare("UPDATE session_students SET absent=? WHERE id=?").run(
        +absent,
        st.id,
      );
      if (absent)
        db.prepare(
          "UPDATE session_devices SET active=0 WHERE session_student_id=?",
        ).run(st.id);
      db.prepare(
        "UPDATE quiz_sessions SET state_version=state_version+1 WHERE id=?",
      ).run(s.id);
    })();
    res.json({ ok: true });
    changed();
  });
  app.put("/api/sessions/:id/bindings", (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    const rows = z
      .array(z.object({ student_id: z.string(), device_id: z.string() }))
      .min(1)
      .max(50)
      .parse(req.body.rows);
    db.transaction(() => {
      for (const row of rows)
        quiz.bind(param(req), row.student_id, row.device_id, owner(req));
    })();
    res.json({ count: rows.length });
    changed();
  });
  app.put("/api/sessions/:id/bindings/:student", (req, res) => {
    quiz.bind(
      param(req),
      param(req, "student"),
      z.string().nullable().parse(req.body.device_id),
      owner(req),
    );
    res.json({ ok: true });
    changed();
  });
  app.post("/api/sessions/:id/commands", (req, res) => {
    quiz.tick();
    const input = z
      .object({
        command_id: z.string().min(1).max(100),
        expected_version: z.number().int().nonnegative(),
        action: z.enum([
          "start",
          "pause",
          "resume",
          "close-question",
          "reveal-results",
          "next",
          "finish",
          "cancel",
        ]),
      })
      .parse(req.body);
    res.json(quiz.command(param(req), owner(req), input));
    changed();
  });
  app.post("/api/sessions/:id/presentation-access", (req, res) => {
    const s = owned(db, "quiz_sessions", param(req), owner(req));
    if (["FINISHED", "CANCELLED"].includes(s.state))
      throw new AppError("FINISHED", "Buổi đã kết thúc");
    res.json({ token: issue("projection-bootstrap", s.id, req, 60000) });
  });
  app.delete("/api/sessions/:id/presentation-access", (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    db.prepare(
      "DELETE FROM access_tokens WHERE resource_id=? AND kind LIKE 'projection%'",
    ).run(param(req));
    realtime.revalidate();
    res.json({ ok: true });
  });
  app.get("/api/sessions/:id/report", (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    res.json(quiz.report(param(req)));
  });
  app.post("/api/sessions/:id/study-guide", async (req, res) => {
    const session = owned(db, "quiz_sessions", param(req), owner(req));
    const { student_id } = z
      .object({ student_id: z.string().min(1).max(80) })
      .strict()
      .parse(req.body);
    if (!config.geminiApiKey)
      throw new AppError(
        "AI_NOT_CONFIGURED",
        "Chưa cấu hình GEMINI_API_KEY trên máy chủ.",
        503,
      );
    if (session.state !== "FINISHED")
      throw new AppError(
        "INVALID_STATE",
        "Chỉ tạo gợi ý AI cho buổi kiểm tra đã kết thúc.",
        409,
      );
    const report = quiz.report(session.id),
      questions: Row[] = report.questions,
      students: Row[] = report.students;
    if (!report.N || !report.stats.participants)
      throw new AppError(
        "NO_RESULTS",
        "Buổi kiểm tra chưa có câu trả lời hợp lệ để phân tích.",
        409,
      );
    const requestKey = `${owner(req)}:${session.id}`;
    if (studyGuideInFlight.has(requestKey))
      throw new AppError(
        "AI_REQUEST_IN_PROGRESS",
        "Đang tạo gợi ý cho buổi này. Vui lòng chờ.",
        409,
      );
    const topicByQuestion = new Map<string, string>(),
      topicStats = new Map<
        string,
        { correctRate: number; questionCount: number }
      >();
    for (const question of questions) {
      if (question.status !== "CLOSED" || question.voided) continue;
      const topic =
        typeof question.data.topic === "string" && question.data.topic.trim()
          ? question.data.topic.trim().slice(0, 100)
          : "Chủ đề chưa phân loại";
      topicByQuestion.set(question.id, topic);
      const stats = topicStats.get(topic) || { correctRate: 0, questionCount: 0 };
      stats.correctRate += question.correct_rate ?? 0;
      stats.questionCount++;
      topicStats.set(topic, stats);
    }
    const student = students.find((candidate) => candidate.id === student_id);
    if (!student || student.absent)
      throw new AppError(
        "STUDENT_NOT_FOUND",
        "Không tìm thấy học sinh dự thi trong báo cáo này.",
        404,
      );
    const weakTopics = new Set<string>();
    for (const answer of student.details as Row[])
      if (answer.scored && answer.choice !== answer.correct_answer) {
        const topic = topicByQuestion.get(String(answer.question_id));
        if (topic) weakTopics.add(topic);
      }
    if (!weakTopics.size)
      throw new AppError(
        "NO_WEAK_TOPICS",
        "Học sinh này không có chủ đề sai hoặc bỏ trống trong các câu được tính điểm.",
        409,
      );
    const input = {
      topics: [...topicStats]
        .filter(([topic]) => weakTopics.has(topic))
        .map(([topic, stats]) => ({
          topic,
          participants: report.stats.participants,
          correct_rate: Math.round(stats.correctRate / stats.questionCount),
        })),
      learners: [
        {
          learner_ref: "HV-01",
          weak_topics: [...weakTopics].slice(0, 12),
        },
      ],
    };

    studyGuideInFlight.add(requestKey);
    try {
      res.json(
        await createStudyGuide(
          input,
          config.geminiApiKey,
          config.geminiModel,
        ),
      );
    } finally {
      studyGuideInFlight.delete(requestKey);
    }
  });
  app.post("/api/sessions/:id/questions/:question/void", (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    const reason = z.string().trim().min(3).max(500).parse(req.body.reason);
    const q = must(
      one(
        db,
        "SELECT * FROM session_questions WHERE id=? AND session_id=?",
        param(req, "question"),
        param(req),
      ),
    );
    if (q.status !== "CLOSED" || q.voided)
      throw new AppError(
        "INVALID_STATE",
        "Chỉ loại câu đã đóng và chưa bị loại",
        409,
      );
    db.transaction(() => {
      db.prepare(
        "UPDATE session_questions SET voided=1,void_reason=? WHERE id=?",
      ).run(reason, q.id);
      quiz.event(
        param(req),
        "question.voided",
        { question_id: q.id, reason },
        owner(req),
      );
    })();
    res.json({ ok: true });
    changed();
  });
  app.get("/api/sessions/:id/export.xlsx", async (req, res) => {
    owned(db, "quiz_sessions", param(req), owner(req));
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment("bao-cao.xlsx")
      .send(await reportExcel(quiz.report(param(req))));
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError("NOT_FOUND", "Không tìm thấy API", 404)),
  );
  app.use(express.static(resolve("dist/client"), { index: false }));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/client/index.html")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = error as Row;
      const validation = error instanceof ZodError;
      const constraint =
        typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT");
      const status = validation ? 422 : constraint ? 409 : e.status || 500;
      const code =
        status === 413
          ? "UPLOAD_TOO_LARGE"
          : e.type === "entity.parse.failed"
            ? "INVALID_JSON"
            : validation
              ? "INVALID_PAYLOAD"
              : constraint
                ? "CONFLICT"
                : e.code || "INTERNAL_ERROR";
      if (status >= 500)
        console.error(
          JSON.stringify({ requestId: res.getHeader("X-Request-Id"), code }),
        );
      res.status(status).json({
        code,
        message:
          status === 413
            ? "Dữ liệu tải lên vượt dung lượng cho phép"
            : e.type === "entity.parse.failed"
              ? "Nội dung JSON không hợp lệ"
              : e.code === "AI_NOT_CONFIGURED"
                ? e.message
                : typeof e.code === "string" && e.code.startsWith("GEMINI_")
                  ? e.message
              : validation
                ? "Dữ liệu chưa hợp lệ"
                : constraint
                  ? "Dữ liệu trùng hoặc đang được sử dụng"
                  : status >= 500
                    ? "Không thể hoàn tất thao tác; thử lại với mã tra cứu"
                    : e.message,
        fieldErrors: validation ? error.issues : e.details,
        requestId: res.getHeader("X-Request-Id"),
      });
    },
  );
  const cleanup = setInterval(() => {
    const now = Date.now();
    db.prepare("DELETE FROM auth_sessions WHERE expires<?").run(now);
    db.prepare("DELETE FROM access_tokens WHERE expires<?").run(now);
    for (const [key, value] of loginAttempts)
      if (value.until < now) loginAttempts.delete(key);
  }, 60000);
  cleanup.unref();
  return {
    app,
    server,
    quiz,
    realtime,
    close: async () => {
      clearInterval(cleanup);
      realtime.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
