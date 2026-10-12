import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

const dir = mkdtempSync(join(tmpdir(), "iot-student-web-"));
const db = openDb(join(dir, "test.sqlite"));
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false,
  simulator: false, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
let app;
const sockets = [];
async function start() {
  app = createApplication(db, config);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${app.server.address().port}`;
}
async function request(path, method = "GET", body, auth, origin = config.origin) {
  const res = await fetch(config.origin + path, { method,
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}),
      ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}
async function browser() {
  const bootstrap = await request("/api/student/session");
  assert.equal(bootstrap.status, 200);
  assert.match(bootstrap.cookie, /^classroom\.student\.sid=/);
  assert.match(bootstrap.data.csrf, /^[0-9a-f]{64}$/);
  return { cookie: bootstrap.cookie, csrf: bootstrap.data.csrf };
}
async function command(session, action) {
  return app.quiz.command(session, teacher.data.id, {
    action, command_id: randomUUID(), expected_version: app.quiz.get(session).state_version,
  });
}
function openRoom(id) {
  return db.transaction(() => {
    const code = String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
    db.prepare("INSERT INTO room_pairing(session_id,room_code,expires_at,auto_assign) VALUES (?,?,?,0) ON CONFLICT(session_id) DO UPDATE SET room_code=excluded.room_code,closed_at=NULL,expires_at=excluded.expires_at")
      .run(id, code, Date.now() + 300000);
    return code;
  })();
}
function createRoom() {
  return app.quiz.create(teacher.data.id, { class_id: "class", bank_id: "bank", name: "Kiểm tra trên web",
    config: { count: 2, seconds: 30, random: false, auto_next: true, allow_change: true, leaderboard: false } });
}
async function connect(auth, ticket) {
  if (!ticket) {
    const result = await request("/api/student/ticket", "POST", {}, auth);
    assert.equal(result.status, 200); ticket = result.data.ticket;
  }
  const ws = new WebSocket(config.origin.replace(/^http/, "ws") + "/ws/student", {
    headers: { Origin: config.origin, Cookie: auth.cookie },
  });
  sockets.push(ws);
  const messages = [];
  ws.on("message", data => messages.push(JSON.parse(data)));
  await once(ws, "open");
  ws.send(JSON.stringify({ v: 1, type: "hello", ticket }));
  async function wait(type, predicate = () => true) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const index = messages.findIndex(m => m.type === type && predicate(m));
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error(`No ${type}`);
  }
  return { ws, wait, send: packet => ws.send(JSON.stringify(packet)) };
}
await start();
let teacher;
try {
  teacher = await request("/api/auth/register", "POST", { email: "teacher-web@example.test", password: "test-password" });
  assert.equal(teacher.status, 201);
  const teacherAuth = { cookie: teacher.cookie, csrf: teacher.data.csrf };
  db.prepare("INSERT INTO classes VALUES ('class',?,'Lớp web',0)").run(teacher.data.id);
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank',?,'Đề web')").run(teacher.data.id);
  for (const code of ["001", "002", "003", "004"]) db.prepare("INSERT INTO students VALUES (?, 'class', ?, ?)").run(`st-${code}`, code, `Học sinh ${code}`);
  for (let i = 1; i <= 2; i++) db.prepare("INSERT INTO questions VALUES (?, 'bank', ?)").run(`q${i}`, JSON.stringify({
    question: `Nội dung câu ${i}`, option_a: "Lựa chọn A", option_b: "Lựa chọn B", option_c: "Lựa chọn C", option_d: "Lựa chọn D",
    correct_answer: "A", explanation: "PRIVATE_EXPLANATION", topic: "Test", difficulty: "easy",
  }));
  const session = createRoom(), code = openRoom(session);
  const student = await browser(), other = await browser();
  const packet = { student_code: "001", room_code: code, request_id: randomUUID() };
  assert.equal((await request("/api/student/join", "POST", packet, student, "http://evil.test")).data.code, "BAD_ORIGIN");
  assert.equal((await request("/api/student/join", "POST", packet, { ...student, csrf: "bad" })).data.code, "CSRF");
  assert.equal((await request("/api/student/join", "POST", { ...packet, student_code: "999" }, student)).data.code, "STUDENT_UNAVAILABLE");
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, 0);
  assert.equal((await request("/api/student/join", "POST", { ...packet, room_code: "00000000" }, student)).data.code, "ROOM_UNAVAILABLE");
  const joined = await request("/api/student/join", "POST", packet, { ...student, cookie: `${student.cookie}; ${teacher.cookie}` });
  assert.equal(joined.status, 201);
  const identity = joined.data.student;
  assert.equal(identity.student_code, "001");
  assert.equal((await request("/api/student/join", "POST", packet, student)).data.duplicate, true);
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, 1);
  assert.equal((await request("/api/auth/me", "GET", undefined, teacherAuth)).data.id, teacher.data.id);
  assert.equal((await request("/api/devices", "GET", undefined, student)).status, 401);
  assert.equal((await request(`/api/sessions/${session}/commands`, "POST", {}, student)).status, 401);
  assert.equal((await request("/api/student/join", "POST", { ...packet, request_id: randomUUID() }, other)).data.code, "STUDENT_ALREADY_BOUND");
  assert.equal((await request("/api/student/join", "POST", { ...packet, student_code: "002", request_id: randomUUID() }, student)).data.code, "STUDENT_BUSY");
  assert.equal((await request("/api/student/leave", "POST", {}, student)).data.code, "STUDENT_BUSY");
  const restored = await request("/api/student/session", "GET", undefined, student);
  assert.equal(restored.data.student.binding_id, identity.binding_id);
  const serialized = JSON.stringify(restored.data);
  for (const privateValue of ["correct_answer", "PRIVATE_EXPLANATION", "secret", "Học sinh 002", '"students"']) assert(!serialized.includes(privateValue));

  // Simulate a server failure after the pairing commit and before recording the successful browser identity.
  const login = db.prepare("SELECT * FROM auth_sessions WHERE json_extract(data,'$.student.binding_id')=?").get(identity.binding_id);
  const saved = JSON.parse(login.data);
  const original = { v: 1, ...packet, device_name: "Web 001", device_secret: saved.studentDevice.secret };
  delete saved.student; delete saved.studentDevice;
  saved.studentJoin = original;
  db.prepare("UPDATE auth_sessions SET data=? WHERE sid=?").run(JSON.stringify(saved), login.sid);
  db.prepare("UPDATE room_pairing SET closed_at=? WHERE session_id=?").run(Date.now(), session);
  assert.equal((await request("/api/student/session", "GET", undefined, student)).data.pending.request_id, packet.request_id);
  assert.equal((await request("/api/student/join", "POST", { ...packet, request_id: randomUUID() }, student)).data.code, "STUDENT_JOIN_PENDING");
  assert.equal((await request("/api/student/join", "POST", packet, student)).data.duplicate, true);
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, 1);

  const stolen = await request("/api/student/ticket", "POST", {}, student);
  const intruder = await connect(other, stolen.data.ticket);
  assert.equal((await intruder.wait("error")).code, "INVALID_PAYLOAD");
  intruder.ws.terminate();
  let peer = await connect(student);
  const lobby = (await peer.wait("session.snapshot")).data;
  assert.equal(lobby.state, "LOBBY");
  assert.equal(app.realtime.teacherSnapshot(session).students.find(s => s.student_code === "001").online, true);
  peer.send({ v: 1, type: "device.rename", request_id: "forbidden", label: "002" });
  assert.equal((await peer.wait("error")).code, "INVALID_PAYLOAD");
  peer.send({ v: 1, type: "hello", session_id: session });
  assert.equal((await peer.wait("error")).code, "INVALID_PAYLOAD");
  await command(session, "start"); app.realtime.schedule();
  const running = (await peer.wait("session.snapshot", m => m.data.state === "RUNNING")).data;
  assert.equal(running.question.question, "Nội dung câu 1");
  assert.equal(running.question.option_a, "Lựa chọn A");
  assert(!JSON.stringify(running).includes("correct_answer"));
  const answer = { v: 1, type: "answer.submit", request_id: randomUUID(), session_id: session,
    question_instance_id: running.question.id, binding_id: running.binding_id, seq: 1, choice: "A" };
  peer.send({ ...answer, binding_id: "other-binding" });
  assert.equal((await peer.wait("error")).code, "INVALID_PAYLOAD");
  peer.send(answer); assert.equal((await peer.wait("answer.ack")).accepted, true);
  peer.send(answer); assert.equal((await peer.wait("answer.ack")).duplicate, true);
  await command(session, "pause"); app.realtime.schedule();
  assert.equal((await peer.wait("session.snapshot", m => m.data.state === "PAUSED")).data.state, "PAUSED");
  peer.send({ ...answer, request_id: randomUUID(), seq: 2, choice: "B" });
  assert.equal((await peer.wait("answer.ack")).code, "SESSION_PAUSED");

  // Browser cookie and its binding survive an application restart; simulator remains disabled.
  for (const ws of sockets) ws.terminate();
  await app.close(); await start();
  assert.equal((await request("/api/student/session", "GET", undefined, student)).data.snapshot.state, "PAUSED");
  peer = await connect(student);
  const paused = (await peer.wait("session.snapshot")).data;
  assert.equal(paused.current_answer.choice, "A");
  assert.equal(paused.current_answer.seq, 1);
  await command(session, "resume"); app.realtime.schedule();
  await peer.wait("session.snapshot", m => m.data.state === "RUNNING");
  peer.send({ ...answer, request_id: randomUUID(), seq: 2, choice: "B" });
  assert.equal((await peer.wait("answer.ack")).accepted, true);
  db.prepare("UPDATE session_questions SET deadline_at=? WHERE id=?").run(Date.now() - 1, answer.question_instance_id);
  peer.send({ ...answer, request_id: randomUUID(), seq: 3, choice: "C" });
  assert.equal((await peer.wait("answer.ack")).code, "QUESTION_CLOSED");
  await command(session, "finish"); app.realtime.schedule();
  const finished = (await peer.wait("session.snapshot", m => m.data.state === "FINISHED")).data;
  assert.equal(finished.result.correct, 0);
  assert.equal(finished.result.total, 1);
  assert.equal(finished.result.score, 0);
  peer.send(answer); assert.equal((await peer.wait("answer.ack")).duplicate, true);
  const final = await request("/api/student/session", "GET", undefined, student);
  assert.deepEqual(final.data.snapshot.result, finished.result);
  assert.equal((await request("/api/student/leave", "POST", {}, student)).status, 200);
  assert.equal((await request("/api/student/ticket", "POST", {}, student)).status, 401);

  // A new browser may use the same MSSV in a later exam, despite historical virtual devices.
  const nextSession = createRoom(), nextCode = openRoom(nextSession);
  const next = await request("/api/student/join", "POST", { student_code: "001", room_code: nextCode, request_id: randomUUID() }, other);
  assert.equal(next.status, 201);
  peer = await connect(other); await peer.wait("session.snapshot");
  const remove = await request(`/api/sessions/${nextSession}/room-devices/${next.data.student.device_id}`, "DELETE", undefined, teacherAuth);
  assert.equal(remove.status, 200);
  assert.equal((await request("/api/student/ticket", "POST", {}, other)).status, 401);
  app.realtime.schedule();
  const [closeCode] = await once(peer.ws, "close"); assert.equal(closeCode, 4001);
  console.log("PASS: student web joins, CSRF/origin, independent cookies, exact MSSV, no teacher access/data leakage, lost-response retries, scoped tickets, live answers, duplicate ACK, pause/deadline, restart/reconnect, own results, historical devices, removal.");
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close(); db.close(); rmSync(dir, { recursive: true, force: true });
}
