import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import session from "express-session";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
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
import { preview, template, studentSchema, reportExcel } from "./imports.js";
import { questionSchema, configSchema } from "../shared/protocol.js";
import { attachRealtime } from "./realtime.js";
export type AppConfig = {
  origin: string;
  secret: string;
  production: boolean;
  simulator: boolean;
  trustProxy: number;
  maxUpload: number;
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
    const kind = z.enum(["questions", "students"]).parse(req.params.kind),
      format = z.enum(["csv", "xlsx"]).parse(req.params.format);
    res
      .type(
        format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .attachment(`${kind}.${format}`)
      .send(await template(kind, format));
  });
  let parsing = false;
  app.post(
    "/api/imports/:kind/preview",
    express.raw({ type: "application/octet-stream", limit: config.maxUpload }),
    async (req, res) => {
      const kind = z.enum(["questions", "students"]).parse(req.params.kind);
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
        res.json(
          await preview(
            req.body,
            decodeURIComponent(req.get("X-Filename") || ""),
            kind,
          ),
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
