import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import { studentSchema, preview, previewResults, template, reportExcel, attendanceExcel } from "../dist/server/server/imports.js";
import { joinSchema } from "../dist/server/server/pairing.js";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";
import { Attendance } from "../dist/server/server/live.js";

const invalid = ["HS001", "DEMO01", "SV-001", "123ABC", "12 34", "12345678901", "１２３", "", "   ", 123, null];
const row = student_code => ({ student_code, full_name: "Test Student" });
const packet = student_code => ({ v: 1, room_code: "12345678", request_id: randomUUID(),
  device_name: "ESP32", device_secret: randomBytes(32).toString("hex"), student_code });
const csv = codes => Buffer.from("student_code,full_name\r\n" + codes.map(code => `"${code}",Test Student`).join("\r\n") + "\r\n");
async function xlsx(codes, kind = "students") {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet(kind === "results" ? "Results" : "Students");
  sheet.addRow(kind === "results" ? ["row_type", "student_code", "full_name", "Q1"] : ["student_code", "full_name"]);
  if (kind === "results") sheet.addRow(["ANSWER_KEY", "", "", "A"]);
  for (const code of codes) sheet.addRow(kind === "results" ? ["STUDENT", code, "Test Student", "A"] : [code, "Test Student"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

for (const code of ["0", "001", "1", "000123", "2313401234", " 001 ", "\t000123\n"]) {
  test(`management and ESP32 schemas accept and preserve ${JSON.stringify(code)}`, () => {
    assert.equal(studentSchema.parse(row(code)).student_code, code.trim());
    assert.equal(joinSchema.parse(packet(code)).student_code, code.trim());
  });
}
for (const code of invalid) {
  test(`both MSSV schemas reject ${JSON.stringify(code)} without coercion`, () => {
    assert.equal(studentSchema.safeParse(row(code)).success, false);
    assert.equal(joinSchema.safeParse(packet(code)).success, false);
  });
}
test("an omitted MSSV still permits the simulator/manual join packet", () => {
  const p = packet("001"); delete p.student_code;
  assert.equal(joinSchema.safeParse(p).success, true);
});

for (const format of ["csv", "xlsx"]) {
  const bytes = async codes => format === "csv" ? csv(codes) : xlsx(codes);
  test(`${format}: leading zeros, maximum length and outer whitespace survive preview`, async () => {
    const p = await preview(await bytes(["001", "1", "2313401234", " 000123 "]), `students.${format}`, "students");
    assert.deepEqual(p.errors, []);
    assert.deepEqual(p.rows.map(r => r.student_code), ["001", "1", "2313401234", "000123"]);
    assert.ok(p.rows.every(r => typeof r.student_code === "string"));
  });
  test(`${format}: duplicate normalized codes are rejected, distinct zero prefixes are allowed`, async () => {
    const p = await preview(await bytes(["001", " 001 ", "1"]), `students.${format}`, "students");
    assert.equal(p.errors.filter(e => e.column === "student_code").length, 1);
    assert.deepEqual(p.rows.map(r => r.student_code), ["001", "001", "1"]);
  });
  for (const code of ["HS001", "DEMO01", "123ABC", "12 34", "12345678901"]) {
    test(`${format}: invalid code ${code} has a row/column error and is not rewritten`, async () => {
      const p = await preview(await bytes([code]), `students.${format}`, "students");
      assert.ok(p.errors.some(e => e.row === 2 && e.column === "student_code"));
      assert.equal(p.rows[0].student_code, code);
    });
  }
  test(`${format}: result import uses the same code policy`, async () => {
    const contents = format === "csv"
      ? Buffer.from("row_type,student_code,full_name,Q1\r\nANSWER_KEY,,,A\r\nSTUDENT, 001 ,Test Student,A\r\nSTUDENT,1,Test Student,B\r\nSTUDENT,HS001,Test Student,A\r\n")
      : await xlsx([" 001 ", "1", "HS001"], "results");
    const p = await previewResults(contents, `results.${format}`);
    assert.deepEqual(p.students.map(s => s.student_code), ["001", "1", "HS001"]);
    assert.ok(p.errors.some(e => e.column === "student_code"));
  });
  for (const kind of ["students", "results"]) {
    test(`${format}: the ${kind} template contains valid numeric string codes`, async () => {
      const p = kind === "students"
        ? await preview(await template(kind, format), `template.${format}`, kind)
        : await previewResults(await template(kind, format, 1), `template.${format}`);
      assert.deepEqual(p.errors, []);
      for (const s of p.rows ?? p.students) {
        assert.equal(typeof s.student_code, "string");
        assert.match(s.student_code, /^[0-9]{1,10}$/);
        assert.equal(studentSchema.safeParse(s).success, true);
      }
    });
  }
}
for (const kind of ["students", "results"]) {
  test(`XLSX ${kind}: numeric cells are rejected rather than guessing a lost zero prefix`, async () => {
    const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet(kind === "students" ? "Students" : "Results");
    sheet.addRow(kind === "students" ? ["student_code", "full_name"] : ["row_type", "student_code", "full_name", "Q1"]);
    if (kind === "results") sheet.addRow(["ANSWER_KEY", "", "", "A"]);
    const r = sheet.addRow(kind === "students" ? [1, "Test Student"] : ["STUDENT", 1, "Test Student", "A"]);
    r.getCell(kind === "students" ? 1 : 2).numFmt = "000";
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const p = kind === "students" ? await preview(bytes, "numeric.xlsx", kind) : await previewResults(bytes, "numeric.xlsx");
    assert.ok(p.errors.some(e => e.column === "student_code" && /Text/.test(e.message)));
    assert.notEqual((p.rows ?? p.students)[0].student_code, "001");
  });
}
test("XLSX formula student codes are rejected", async () => {
  const p = await preview(await xlsx([{ formula: '"001"', result: "001" }]), "formula.xlsx", "students");
  assert.ok(p.errors.some(e => e.column === "student_code" && /công thức/.test(e.message)));
});

async function fixture(t, codes = ["001", "1", "2313401234"]) {
  const db = openDb(":memory:");
  const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false,
    simulator: true, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
  const app = createApplication(db, config);
  t.after(async () => { await app.close(); db.close(); });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, method = "GET", body, auth) => {
    const res = await fetch(config.origin + path, { method, headers: {
      Origin: config.origin, "Content-Type": "application/json",
      ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const teacher = await request("/api/auth/register", "POST", { email: "mssv@example.test", password: "StudentCodeTest2026!" });
  assert.equal(teacher.status, 201);
  const owner = teacher.data.id, auth = { cookie: teacher.cookie, csrf: teacher.data.csrf };
  db.prepare("INSERT INTO classes VALUES ('c',?,'Fixture',0)").run(owner);
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank',?,'Fixture')").run(owner);
  db.prepare("INSERT INTO questions VALUES ('q','bank',?)").run(JSON.stringify({ question: "Q", option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A" }));
  for (const code of codes) db.prepare("INSERT INTO students VALUES (?,'c',?,?)").run(`st-${code}`, code, "Test Student");
  const cfg = { count: 1, seconds: 30, random: false, auto_next: false, allow_change: true, pass_mark: 5, leaderboard: false };
  const room = () => app.quiz.create(owner, { class_id: "c", bank_id: "bank", name: "Fixture", config: cfg });
  const open = async id => {
    const r = await request(`/api/sessions/${id}/pairing/open`, "POST", { command_id: randomUUID(), expected_version: app.quiz.get(id).state_version }, auth);
    assert.equal(r.status, 200); return r.data.room_code;
  };
  const browser = async () => {
    const r = await request("/api/student/session"); return { cookie: r.cookie, csrf: r.data.csrf };
  };
  const commit = students => ({ name: "Imported", bank_id: "bank", pass_mark: 5, answer_key: ["A"],
    students: students.map(code => ({ ...row(code), answers: ["A"] })), class: { mode: "existing", class_id: "c" } });
  return { db, app, owner, auth, request, room, open, browser, commit, cfg };
}
test("student create/update endpoints validate before writing and preserve existing rows", async t => {
  const f = await fixture(t, []), { request, auth, db } = f;
  assert.equal((await request("/api/classes/c/students/import", "POST", { rows: [row(" 001 "), row("1")] }, auth)).status, 200);
  const before = db.prepare("SELECT * FROM students ORDER BY student_code").all();
  assert.deepEqual(before.map(s => s.student_code), ["001", "1"]);
  for (const code of invalid) {
    assert.equal((await request("/api/classes/c/students/import", "POST", { rows: [row(code)] }, auth)).status, 422);
    assert.equal((await request(`/api/classes/c/students/${before[0].id}`, "PATCH", row(code), auth)).status, 422);
    assert.deepEqual(db.prepare("SELECT * FROM students ORDER BY student_code").all(), before);
  }
});
test("student update trims a valid code and keeps its identity and default device mapping", async t => {
  const f = await fixture(t), before = f.db.prepare("SELECT id FROM students WHERE student_code='001'").get();
  f.db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES ('board',?,'ESP32','hash')").run(f.owner);
  f.db.prepare("INSERT INTO student_devices VALUES (?, 'board')").run(before.id);
  const r = await f.request(`/api/classes/c/students/${before.id}`, "PATCH", row(" 000123 "), f.auth);
  assert.equal(r.status, 200);
  assert.deepEqual(f.db.prepare("SELECT id,student_code FROM students WHERE id=?").get(before.id), { id: before.id, student_code: "000123" });
  assert.equal(f.db.prepare("SELECT device_id FROM student_devices WHERE student_id=?").get(before.id).device_id, "board");
});
test("batch import rolls back all rows when any normalized code is duplicate or invalid", async t => {
  const f = await fixture(t, []);
  for (const [codes, status, code] of [[["001", " 001 "], 400, "DUPLICATE_CODE"], [["002", "HS001"], 422, "INVALID_PAYLOAD"]]) {
    const r = await f.request("/api/classes/c/students/import", "POST", { rows: codes.map(row) }, f.auth);
    assert.equal(r.status, status); assert.equal(r.data.code, code);
    assert.equal(f.db.prepare("SELECT count(*) n FROM students").get().n, 0);
  }
});
test("native HTTP pairing preserves zero prefixes, supports trim, and retries the same request", async t => {
  const f = await fixture(t), id = f.room(), code = await f.open(id);
  for (const student_code of [" 001 ", "1", "2313401234"]) {
    const p = { ...packet(student_code), room_code: code };
    const r = await f.request("/api/device-pairing/join", "POST", p);
    assert.equal(r.status, 201);
    const binding = f.db.prepare("SELECT st.student_code,d.label,d.secret_hash FROM session_devices b JOIN session_students st ON st.id=b.session_student_id JOIN devices d ON d.id=b.device_id WHERE b.device_id=? AND b.active=1").get(r.data.device_id);
    assert.equal(binding.student_code, student_code.trim());
    const duplicate = await f.request("/api/device-pairing/join", "POST", p);
    assert.equal(duplicate.status, 200); assert.equal(duplicate.data.duplicate, true);
    assert.equal(duplicate.data.device_id, r.data.device_id);
  }
});
test("invalid native packets cannot create devices, bindings, or join receipts", async t => {
  const f = await fixture(t), id = f.room(), code = await f.open(id);
  for (const student_code of invalid) {
    const r = await f.request("/api/device-pairing/join", "POST", { ...packet(student_code), room_code: code });
    assert.equal(r.status, 422); assert.equal(r.data.code, "INVALID_PAYLOAD");
  }
  for (const table of ["devices", "session_devices", "room_join_receipts"]) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
});
test("Student Web join distinguishes 001 from 1, trims, and preserves reconnect/retry identity", async t => {
  const f = await fixture(t), id = f.room(), room_code = await f.open(id);
  for (const student_code of [" 001 ", "1", "2313401234"]) {
    const auth = await f.browser(), p = { student_code, room_code, request_id: randomUUID() };
    const r = await f.request("/api/student/join", "POST", p, auth);
    assert.equal(r.status, 201); assert.equal(r.data.student.student_code, student_code.trim());
    const same = await f.request("/api/student/join", "POST", p, auth);
    assert.equal(same.status, 200); assert.equal(same.data.student.binding_id, r.data.student.binding_id);
    const resumed = await f.request("/api/student/session", "GET", undefined, auth);
    assert.equal(resumed.data.student.student_code, student_code.trim());
    assert.equal(resumed.data.snapshot.binding_id, r.data.student.binding_id);
  }
});
test("invalid Student Web requests never bind to a numeric student after dropping letters", async t => {
  const f = await fixture(t), id = f.room(), room_code = await f.open(id), auth = await f.browser();
  for (const student_code of invalid) {
    const r = await f.request("/api/student/join", "POST", { student_code, room_code, request_id: randomUUID() }, auth);
    assert.equal(r.status, 422); assert.equal(r.data.code, "INVALID_PAYLOAD");
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM session_devices").get().n, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM devices").get().n, 0);
});
test("simulator packets without MSSV still wait for manual binding by student ID", async t => {
  const f = await fixture(t), id = f.room(), room_code = await f.open(id), p = packet("001");
  delete p.student_code;
  const r = await f.request("/api/simulator/pairing/join", "POST", { ...p, room_code }, f.auth);
  assert.equal(r.status, 201); assert.equal(r.data.status, "UNASSIGNED");
  const student = f.db.prepare("SELECT id FROM session_students WHERE session_id=? AND student_code='001'").get(id);
  const bound = await f.request(`/api/sessions/${id}/bindings/${student.id}`, "PUT", { device_id: r.data.device_id }, f.auth);
  assert.equal(bound.status, 200);
  assert.equal(f.app.quiz.deviceSnapshot(r.data.device_id).binding_id.length > 0, true);
});
test("result commit rejects invalid new codes without creating a class, session or scores", async t => {
  const f = await fixture(t);
  for (const code of invalid.slice(0, 7)) {
    const p = { ...f.commit([code]), class: { mode: "new", name: "Rejected" } };
    const r = await f.request("/api/imports/results/commit", "POST", p, f.auth);
    assert.equal(r.status, 422);
    assert.equal(f.db.prepare("SELECT count(*) n FROM quiz_sessions").get().n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM classes").get().n, 1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM answers").get().n, 0);
  }
});
test("valid result commit preserves distinct zero-prefixed students and scores", async t => {
  const f = await fixture(t);
  const r = await f.request("/api/imports/results/commit", "POST", f.commit([" 001 ", "1"]), f.auth);
  assert.equal(r.status, 201);
  const report = f.app.quiz.report(r.data.id);
  assert.equal(report.students.find(s => s.student_code === "001").score, 10);
  assert.equal(report.students.find(s => s.student_code === "1").score, 10);
  assert.equal(report.students.find(s => s.student_code === "2313401234").absent, 1);
});
test("a legacy roster cannot create a new quiz, attendance or imported result snapshot", async t => {
  const f = await fixture(t, ["001", "HS001"]), before = f.db.prepare("SELECT * FROM students ORDER BY id").all();
  assert.throws(() => f.room(), e => e.code === "INVALID_STUDENT_CODE");
  assert.throws(() => new Attendance(f.db).create(f.owner, "c"), e => e.code === "INVALID_STUDENT_CODE");
  const r = await f.request("/api/imports/results/commit", "POST", f.commit(["001"]), f.auth);
  assert.equal(r.status, 422); assert.equal(r.data.code, "INVALID_STUDENT_CODE");
  for (const table of ["quiz_sessions", "session_students", "attendance_sessions", "attendance_marks", "answers"]) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.db.prepare("SELECT * FROM students ORDER BY id").all(), before);
});
test("stored padded codes are not silently canonicalized into new snapshots", async t => {
  const f = await fixture(t, [" 001 ", "1"]), before = f.db.prepare("SELECT * FROM students ORDER BY id").all();
  assert.throws(() => f.room(), e => e.code === "INVALID_STUDENT_CODE");
  assert.throws(() => new Attendance(f.db).create(f.owner, "c"), e => e.code === "INVALID_STUDENT_CODE");
  const r = await f.request("/api/imports/results/commit", "POST", f.commit(["1"]), f.auth);
  assert.equal(r.status, 422); assert.equal(r.data.code, "INVALID_STUDENT_CODE");
  assert.equal(f.db.prepare("SELECT count(*) n FROM quiz_sessions").get().n, 0);
  assert.deepEqual(f.db.prepare("SELECT * FROM students ORDER BY id").all(), before);
});
test("legacy codes and old snapshots remain readable, scoreable, exportable and manually bindable", async t => {
  const f = await fixture(t, ["HS001"]), { db, app, owner } = f;
  db.prepare("INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,created_at) VALUES ('old',?,'c','bank','Fixture','Legacy','87654321',?,'LOBBY',0)").run(owner, JSON.stringify(f.cfg));
  db.prepare("INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES ('old-st','old','st-HS001','HS001','Test Student')").run();
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES ('old-board',?,'Shared Board','unchanged-hash')").run(owner);
  app.quiz.bind("old", "old-st", "old-board", owner);
  const command = action => app.quiz.command("old", owner, { action, command_id: randomUUID(), expected_version: app.quiz.get("old").state_version });
  command("start");
  const snapshot = app.quiz.deviceSnapshot("old-board");
  assert.equal(app.quiz.answer("old-board", { v: 1, type: "answer.submit", request_id: randomUUID(),
    session_id: "old", binding_id: snapshot.binding_id, question_instance_id: snapshot.question.id, seq: 1, choice: "A" }).accepted, true);
  if (app.quiz.get("old").state !== "FINISHED") command("finish");
  const report = app.quiz.report("old"), before = JSON.stringify(report);
  assert.equal(report.students[0].student_code, "HS001"); assert.equal(report.students[0].score, 10);
  assert.equal((await f.request("/api/classes/c", "GET", undefined, f.auth)).data.students[0].student_code, "HS001");
  const exported = new ExcelJS.Workbook(); await exported.xlsx.load(await reportExcel(report));
  assert.equal(exported.getWorksheet("Hoc_sinh").getCell("A2").value, "HS001");
  assert.equal((await f.request("/api/classes/c/students/st-HS001", "PATCH", row("HS001"), f.auth)).status, 422);
  assert.equal(JSON.stringify(app.quiz.report("old")), before);
  assert.equal(db.prepare("SELECT student_code FROM students").get().student_code, "HS001");
  assert.deepEqual(db.prepare("SELECT id,label,secret_hash FROM devices").get(), { id: "old-board", label: "Shared Board", secret_hash: "unchanged-hash" });
});
test("XLSX attendance exports keep string codes and old historical values", async () => {
  const bytes = await attendanceExcel({ class_name: "Fixture", created_at: 0, closed_at: null, present: 0, total: 3,
    students: ["001", "1", "HS001"].map(student_code => ({ student_code, full_name: "Test Student", status: "ABSENT", marked_at: null })) });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  assert.deepEqual([7, 8, 9].map(i => wb.worksheets[0].getCell(`B${i}`).value), ["001", "1", "HS001"]);
});
test("demo creation uses numeric codes and preserves pre-existing legacy students", t => {
  const dir = mkdtempSync(join(tmpdir(), "smartclass-mssv-demo-")), path = join(dir, "test.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDb(path);
  db.prepare("INSERT INTO teachers(id,email,password_hash,created_at) VALUES ('teacher','demo@example.test','fixture',0)").run();
  db.prepare("INSERT INTO classes VALUES ('old-class','teacher','Legacy',0)").run();
  db.prepare("INSERT INTO students VALUES ('old-st','old-class','DEMO01','Legacy Student')").run();
  db.close();
  const seeded = spawnSync(process.execPath, ["scripts/seed-room-demo.mjs", "demo@example.test"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: path }, encoding: "utf8", timeout: 10000,
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  const result = JSON.parse(seeded.stdout), after = openDb(path);
  try {
    const students = after.prepare("SELECT student_code FROM students WHERE class_id=? ORDER BY student_code").all(result.classId);
    assert.ok(students.length > 0);
    assert.equal(students[0].student_code, "001");
    assert.equal(new Set(students.map(s => s.student_code)).size, students.length);
    for (const s of students) { assert.equal(typeof s.student_code, "string"); assert.match(s.student_code, /^[0-9]{1,10}$/); }
    assert.equal(after.prepare("SELECT student_code FROM students WHERE id='old-st'").get().student_code, "DEMO01");
  } finally { after.close(); }
});
