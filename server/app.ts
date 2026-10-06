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
  Flashcards,
  shareToken,
  shareTokenPattern,
  reviewCommandSchema,
} from "./flashcards.js";
import { Polls, Attendance, pollCommandSchema } from "./live.js";
import {
  preview,
  previewResults,
  template,
  studentSchema,
  reportExcel,
  attendanceExcel,
} from "./imports.js";
import {
  questionSchema,
  configSchema,
  flashcardSchema,
} from "../shared/protocol.js";
import { attachRealtime } from "./realtime.js";
import { createStudyGuide } from "./study-guide.js";
export type AppConfig = {
  origin: string;
  secret: string;
  production: boolean;
  simulator: boolean;
  trustProxy: number;
  maxUpload: number;
  openRouterApiKeys: string[];
};
const nameSchema = z.string().trim().min(1).max(150);
export function createApplication(db: DB, config: AppConfig) {
  const app = express(),
    server = createServer(app),
    quiz = new Quiz(db),
    flashcards = new Flashcards(db),
    polls = new Polls(db),
    attendance = new Attendance(db);
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
  const registrationAttempts = new Map<string, { count: number; until: number }>();
  const studyGuideInFlight = new Set<string>();
  let loginInFlight = 0;
  let registrationInFlight = 0;
  app.post("/api/auth/register", async (req, res) => {
    const key = req.ip || "unknown",
      now = Date.now();
    let rate = registrationAttempts.get(key);
    if (!rate || rate.until < now) {
      rate = { count: 0, until: now + 60 * 60000 };
      registrationAttempts.set(key, rate);
    }
    if (++rate.count > 5 || registrationInFlight >= 2)
      throw new AppError(
        "RATE_LIMIT",
        "Đăng ký quá nhiều lần; vui lòng thử lại sau",
        429,
      );
    const input = z
      .object({
        email: z.string().trim().email().max(200),
        password: z.string().min(12).max(200),
      })
      .strict()
      .parse(req.body);
    const email = input.email.toLowerCase();
    if (one(db, "SELECT 1 FROM teachers WHERE email=?", email))
      throw new AppError("EMAIL_EXISTS", "Email này đã có tài khoản", 409);
    registrationInFlight++;
    let encoded: string;
    try {
      encoded = await passwordHash(input.password);
    } finally {
      registrationInFlight--;
    }
    const id = randomUUID();
    try {
      db.prepare("INSERT INTO teachers VALUES (?,?,?,?)").run(
        id,
        email,
        encoded,
        Date.now(),
      );
    } catch (e) {
      if (
        typeof (e as { code?: unknown }).code === "string" &&
        String((e as { code: string }).code).startsWith("SQLITE_CONSTRAINT")
      )
        throw new AppError("EMAIL_EXISTS", "Email này đã có tài khoản", 409);
      throw e;
    }
    await new Promise<void>((done, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : done())),
    );
    req.session.teacherId = id;
    req.session.csrf = token();
    res.status(201).json({
      id,
      email,
      csrf: req.session.csrf,
      simulator: config.simulator,
    });
  });
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
  // Self-study link: anyone holding the deck's share token may read its cards, nothing else.
  app.get("/api/public/flashcards/:token", (req, res) => {
    const token = String(req.params.token);
    if (!shareTokenPattern.test(token))
      throw new AppError(
        "NOT_FOUND",
        "Link tự học không còn hiệu lực. Hỏi lại giáo viên link mới.",
        404,
      );
    res.json(flashcards.publicDeck(token));
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
  const realtime = attachRealtime(
    server,
    db,
    quiz,
    auth,
    config,
    flashcards,
    polls,
    attendance,
  );
  const changed = () => realtime.schedule();
  app.get("/api/auth/me", (req, res) => {
    const t = must(
      one(db, "SELECT id,email FROM teachers WHERE id=?", owner(req)),
    );
    res.json({
      ...t,
      csrf: req.session.csrf,
      simulator: config.simulator,
      ai: config.openRouterApiKeys.length > 0,
    });
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
        "SELECT s.*,sd.device_id,d.label device_label,d.revoked device_revoked FROM students s LEFT JOIN student_devices sd ON sd.student_id=s.id LEFT JOIN devices d ON d.id=sd.device_id WHERE s.class_id=? ORDER BY s.student_code",
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
  app.delete("/api/classes/:id", (req, res) => {
    const c = owned(db, "classes", param(req), owner(req));
    db.transaction(() => {
      if (
        one(db, "SELECT id FROM quiz_sessions WHERE class_id=? LIMIT 1", c.id) ||
        one(db, "SELECT id FROM attendance_sessions WHERE class_id=? LIMIT 1", c.id)
      )
        throw new AppError(
          "CLASS_HAS_HISTORY",
          "Lớp đã có buổi kiểm tra hoặc lịch sử điểm danh. Hãy lưu trữ lớp để giữ lại báo cáo.",
          409,
        );
      db.prepare(
        "DELETE FROM student_devices WHERE student_id IN (SELECT id FROM students WHERE class_id=?)",
      ).run(c.id);
      db.prepare("DELETE FROM students WHERE class_id=?").run(c.id);
      db.prepare("DELETE FROM classes WHERE id=?").run(c.id);
    })();
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
    db.transaction(() => {
      db.prepare(
        "DELETE FROM student_devices WHERE student_id IN (SELECT id FROM students WHERE id=? AND class_id=?)",
      ).run(param(req, "student"), param(req));
      db.prepare("DELETE FROM students WHERE id=? AND class_id=?").run(
        param(req, "student"),
        param(req),
      );
    })();
    res.json({ ok: true });
  });
  // Default device: used to pre-bind quiz rooms and to check students in by button press.
  app.put("/api/classes/:id/students/:student/device", (req, res) => {
    owned(db, "classes", param(req), owner(req));
    const st = must(
      one(
        db,
        "SELECT * FROM students WHERE id=? AND class_id=?",
        param(req, "student"),
        param(req),
      ),
      "Không tìm thấy học sinh",
    );
    const device = z.string().max(80).nullable().parse(req.body.device_id);
    db.transaction(() => {
      if (device) {
        const d = owned(db, "devices", device, owner(req));
        if (d.revoked) throw new AppError("DEVICE_REVOKED", "Thiết bị đã thu hồi");
        const taken = one(
          db,
          "SELECT s.full_name FROM student_devices sd JOIN students s ON s.id=sd.student_id WHERE sd.device_id=? AND s.class_id=? AND s.id<>?",
          device,
          param(req),
          st.id,
        );
        if (taken)
          throw new AppError(
            "DEVICE_IN_USE",
            `Thiết bị ${d.label} đã gán cho ${taken.full_name} trong lớp này`,
            409,
          );
        db.prepare(
          "INSERT INTO student_devices VALUES (?,?) ON CONFLICT(student_id) DO UPDATE SET device_id=excluded.device_id",
        ).run(st.id, device);
      } else db.prepare("DELETE FROM student_devices WHERE student_id=?").run(st.id);
    })();
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
  app.get("/api/flashcard-decks", (req, res) =>
    res.json(
      all(
        db,
        "SELECT d.id,d.name,d.subject,d.share_token,d.created_at,(SELECT count(*) FROM flashcards WHERE deck_id=d.id) card_count,(SELECT id FROM flashcard_reviews WHERE deck_id=d.id AND state='RUNNING') running_review FROM flashcard_decks d WHERE owner_teacher_id=? ORDER BY created_at DESC",
        owner(req),
      ),
    ),
  );
  app.post("/api/flashcard-decks", (req, res) => {
    const input = z
      .object({
        name: nameSchema,
        subject: z.string().trim().max(100).default(""),
      })
      .parse(req.body);
    res
      .status(201)
      .json({ id: flashcards.createDeck(owner(req), input.name, input.subject) });
  });
  app.post("/api/flashcard-decks/from-bank", (req, res) => {
    const bank = z.string().max(80).parse(req.body.bank_id);
    res.status(201).json({ id: flashcards.fromBank(owner(req), bank) });
  });
  app.get("/api/flashcard-decks/:id", (req, res) => {
    const d = owned(db, "flashcard_decks", param(req), owner(req));
    res.json({
      ...d,
      cards: flashcards.cards(d.id),
      reviews: all(
        db,
        "SELECT id,state,round,created_at,finished_at FROM flashcard_reviews WHERE deck_id=? ORDER BY created_at DESC LIMIT 20",
        d.id,
      ),
    });
  });
  app.patch("/api/flashcard-decks/:id", (req, res) => {
    owned(db, "flashcard_decks", param(req), owner(req));
    const input = z
      .object({ name: nameSchema, subject: z.string().trim().max(100) })
      .parse(req.body);
    db.prepare("UPDATE flashcard_decks SET name=?,subject=? WHERE id=?").run(
      input.name,
      input.subject,
      param(req),
    );
    res.json({ ok: true });
  });
  app.delete("/api/flashcard-decks/:id", (req, res) => {
    flashcards.deleteDeck(owner(req), param(req));
    res.json({ ok: true });
  });
  // Enabling issues a fresh token, so re-sharing also revokes any link that leaked.
  app.post("/api/flashcard-decks/:id/share", (req, res) => {
    owned(db, "flashcard_decks", param(req), owner(req));
    const value = z.boolean().parse(req.body.enabled) ? shareToken() : null;
    db.prepare("UPDATE flashcard_decks SET share_token=? WHERE id=?").run(
      value,
      param(req),
    );
    res.json({ share_token: value });
  });
  app.post("/api/flashcard-decks/:id/cards", (req, res) => {
    owned(db, "flashcard_decks", param(req), owner(req));
    flashcards.addCards(param(req), [flashcardSchema.parse(req.body)]);
    res.status(201).json({ ok: true });
  });
  for (const method of ["patch", "delete"] as const)
    app[method]("/api/flashcards/:id", (req, res) => {
      const c = must(
        one(
          db,
          "SELECT c.* FROM flashcards c JOIN flashcard_decks d ON d.id=c.deck_id WHERE c.id=? AND d.owner_teacher_id=?",
          param(req),
          owner(req),
        ),
      );
      if (method === "delete")
        db.prepare("DELETE FROM flashcards WHERE id=?").run(c.id);
      else {
        const input = flashcardSchema.parse(req.body);
        db.prepare("UPDATE flashcards SET front=?,back=? WHERE id=?").run(
          input.front,
          input.back,
          c.id,
        );
      }
      res.json({ ok: true });
    });
  app.post("/api/imports/flashcards/commit", (req, res) => {
    const deck = z.string().parse(req.body.deck_id);
    owned(db, "flashcard_decks", deck, owner(req));
    const rows = z.array(flashcardSchema).min(1).max(500).parse(req.body.rows);
    db.transaction(() => flashcards.addCards(deck, rows))();
    res.json({ count: rows.length });
  });
  app.post("/api/flashcard-reviews", (req, res) => {
    const input = z
      .object({ deck_id: z.string().max(80), shuffle: z.boolean().default(true) })
      .parse(req.body);
    const id = flashcards.createReview(owner(req), input.deck_id, input.shuffle);
    changed();
    res.status(201).json({ id });
  });
  app.get("/api/flashcard-reviews/:id", (req, res) => {
    owned(db, "flashcard_reviews", param(req), owner(req));
    res.json(flashcards.snapshot(param(req), realtime.online));
  });
  app.post("/api/flashcard-reviews/:id/commands", (req, res) => {
    const { action } = reviewCommandSchema.parse(req.body);
    flashcards.command(owner(req), param(req), action);
    changed();
    res.json(flashcards.snapshot(param(req), realtime.online));
  });
  app.get("/api/polls", (req, res) => res.json(polls.list(owner(req))));
  app.post("/api/polls", (req, res) => {
    const id = polls.create(owner(req), req.body);
    changed();
    res.status(201).json({ id });
  });
  app.get("/api/polls/:id", (req, res) => {
    owned(db, "polls", param(req), owner(req));
    res.json(polls.snapshot(param(req), realtime.online));
  });
  app.post("/api/polls/:id/commands", (req, res) => {
    const { action } = pollCommandSchema.parse(req.body);
    polls.command(owner(req), param(req), action);
    changed();
    res.json(polls.snapshot(param(req), realtime.online));
  });
  app.get("/api/attendance", (req, res) => res.json(attendance.list(owner(req))));
  app.post("/api/attendance", (req, res) => {
    const id = attendance.create(owner(req), z.string().max(80).parse(req.body.class_id));
    changed();
    res.status(201).json({ id });
  });
  app.get("/api/attendance/:id", (req, res) => {
    owned(db, "attendance_sessions", param(req), owner(req));
    res.json(attendance.snapshot(param(req), realtime.online));
  });
  app.post("/api/attendance/:id/commands", (req, res) => {
    attendance.command(owner(req), param(req), req.body);
    changed();
    res.json(attendance.snapshot(param(req), realtime.online));
  });
  app.get("/api/attendance/:id/export.xlsx", async (req, res) => {
    owned(db, "attendance_sessions", param(req), owner(req));
    const snap = attendance.snapshot(param(req), realtime.online);
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .attachment(`diem-danh-${new Date(snap.created_at).toISOString().slice(0, 10)}.xlsx`)
      .send(await attendanceExcel(snap));
  });
  app.get("/api/templates/:kind.:format", async (req, res) => {
    const kind = z
        .enum(["questions", "students", "results", "flashcards"])
        .parse(req.params.kind),
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
      const kind = z
        .enum(["questions", "students", "results", "flashcards"])
        .parse(req.params.kind);
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
    if (
      one(db, "SELECT 1 FROM session_devices WHERE device_id=?", d.id) ||
      one(db, "SELECT 1 FROM flashcard_ratings WHERE device_id=?", d.id) ||
      one(db, "SELECT 1 FROM poll_votes WHERE device_id=?", d.id)
    )
      throw new AppError("DEVICE_HAS_HISTORY", "Thiết bị đã dùng trong buổi học; hãy thu hồi để giữ lịch sử", 409);
    db.transaction(() => {
      db.prepare("DELETE FROM student_devices WHERE device_id=?").run(d.id);
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
  app.delete("/api/sessions/:id", (req, res) => {
    const s = owned(db, "quiz_sessions", param(req), owner(req));
    db.transaction(() => {
      if (!["LOBBY", "FINISHED", "CANCELLED"].includes(s.state))
        throw new AppError(
          "SESSION_ACTIVE",
          "Buổi kiểm tra đang chạy hoặc tạm dừng. Hãy kết thúc hoặc hủy buổi trước khi xóa.",
          409,
        );
      db.prepare("DELETE FROM answers WHERE session_question_id IN (SELECT id FROM session_questions WHERE session_id=?)").run(s.id);
      db.prepare("DELETE FROM answer_receipts WHERE binding_id IN (SELECT id FROM session_devices WHERE session_id=?)").run(s.id);
      db.prepare("DELETE FROM session_devices WHERE session_id=?").run(s.id);
      db.prepare("DELETE FROM session_students WHERE session_id=?").run(s.id);
      db.prepare("DELETE FROM session_questions WHERE session_id=?").run(s.id);
      db.prepare("DELETE FROM session_events WHERE session_id=?").run(s.id);
      db.prepare("DELETE FROM commands WHERE session_id=?").run(s.id);
      db.prepare("DELETE FROM access_tokens WHERE resource_id=? AND kind LIKE 'projection%'").run(s.id);
      db.prepare("DELETE FROM quiz_sessions WHERE id=?").run(s.id);
    })();
    realtime.disconnectSession(s.id);
    changed();
    res.json({ ok: true });
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
  // Review deck from the questions one student got wrong (or the whole class struggled with), shared at once.
  app.post("/api/sessions/:id/review-deck", (req, res) => {
    const session = owned(db, "quiz_sessions", param(req), owner(req));
    const { student_id } = z
      .object({ student_id: z.string().min(1).max(80).nullable() })
      .strict()
      .parse(req.body);
    const report = quiz.report(session.id),
      scored: Row[] = report.questions.filter((q: Row) => q.status === "CLOSED" && !q.voided);
    let picked: Row[], name: string;
    if (student_id) {
      const student: Row = must(
        report.students.find((s: Row) => s.id === student_id && !s.absent) as Row | undefined,
        "Không tìm thấy học sinh dự thi trong báo cáo này.",
      );
      const missed = new Set(
        (student.details as Row[])
          .filter((a) => a.scored && a.choice !== a.correct_answer)
          .map((a) => a.question_id),
      );
      picked = scored.filter((q) => missed.has(q.id));
      name = `Ôn tập: ${session.name} · ${student.full_name}`;
    } else {
      picked = scored.filter((q) => (q.correct_rate ?? 100) < 60);
      name = `Ôn tập: ${session.name} · cả lớp`;
    }
    if (!picked.length)
      throw new AppError("NOTHING_TO_REVIEW", "Không có câu cần ôn.", 409);
    const subject = String(
      one(db, "SELECT subject FROM question_banks WHERE id=?", session.bank_id)?.subject ?? "",
    );
    const token = shareToken();
    const deckId = db.transaction(() => {
      const id = flashcards.createDeck(owner(req), name.slice(0, 150), subject);
      flashcards.addCards(
        id,
        picked.map((q) => ({
          front: q.data.question,
          back:
            `${q.data.correct_answer}. ${q.data[`option_${String(q.data.correct_answer).toLowerCase()}`]}` +
            (q.data.explanation ? `

${q.data.explanation}` : ""),
        })),
      );
      db.prepare("UPDATE flashcard_decks SET share_token=? WHERE id=?").run(token, id);
      return id;
    })();
    res.status(201).json({ id: deckId, share_token: token, cards: picked.length });
  });
  app.post("/api/sessions/:id/study-guide", async (req, res) => {
    const session = owned(db, "quiz_sessions", param(req), owner(req));
    const { student_id } = z
      .object({
        student_id: z.string().min(1).max(80),
      })
      .strict()
      .parse(req.body);
    if (!config.openRouterApiKeys.length)
      throw new AppError(
        "AI_NOT_CONFIGURED",
        "Chưa cấu hình OPENROUTER_API_KEYS trên máy chủ.",
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
        await createStudyGuide(input, config.openRouterApiKeys),
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
                : typeof e.code === "string" &&
                    (e.code.startsWith("GEMINI_") ||
                      e.code.startsWith("OPENROUTER_"))
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
    for (const [key, value] of registrationAttempts)
      if (value.until < now) registrationAttempts.delete(key);
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
