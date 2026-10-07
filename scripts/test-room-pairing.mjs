import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import ExcelJS from "exceljs";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

const dir = mkdtempSync(join(tmpdir(), "iot-room-test-"));
let db = openDb(join(dir, "test.sqlite"));
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false, simulator: true, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
let app;
const sockets = [];
async function start() {
  app = createApplication(db, config);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${app.server.address().port}`;
}
async function request(path, method = "GET", body, auth, origin = config.origin) {
  const response = await fetch(config.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0], retryAfter: response.headers.get("retry-after") };
}
async function snapshot(id, auth) { const r = await request(`/api/sessions/${id}`, "GET", undefined, auth); assert.equal(r.status, 200); return r.data; }
async function pairing(action, id, auth, packet) {
  const input = packet ?? { command_id: randomUUID(), expected_version: (await snapshot(id, auth)).state_version };
  return { ...(await request(`/api/sessions/${id}/pairing/${action}`, "POST", input, auth)), input };
}
async function command(action, id, auth) {
  return request(`/api/sessions/${id}/commands`, "POST", { action, command_id: randomUUID(), expected_version: (await snapshot(id, auth)).state_version }, auth);
}
const nativeJoin = (body) => request("/api/device-pairing/join", "POST", body, undefined, null);
const packet = (code, name = "ESP32") => ({ v: 1, room_code: code, request_id: randomUUID(), device_name: name, device_secret: randomBytes(32).toString("hex") });
async function connect(id, secret) {
  const ws = new WebSocket(config.origin.replace(/^http/, "ws") + "/ws", { headers: { Authorization: `Bearer ${secret}`, "X-Device-Id": id } });
  const messages = [];
  ws.on("message", data => messages.push(JSON.parse(data)));
  sockets.push(ws);
  await once(ws, "open");
  async function wait(type, predicate = () => true) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const index = messages.findIndex(m => m.type === type && predicate(m));
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error(`Không nhận ${type}`);
  }
  return { ws, wait, send: p => ws.send(JSON.stringify(p)) };
}
await start();
try {
  const a = await request("/api/auth/register", "POST", { email: "room-a@example.test", password: "room-test-password-2026" });
  const b = await request("/api/auth/register", "POST", { email: "room-b@example.test", password: "room-test-password-2026" });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const auth = { cookie: a.cookie, csrf: a.data.csrf }, other = { cookie: b.cookie, csrf: b.data.csrf };
  for (const teacher of [a, b]) {
    const owner = teacher.data.id;
    db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run(owner, owner, "Lớp thử");
    db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)").run(owner, owner, "Đề thử");
    for (let i = 0; i < 50; i++) db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(`${owner}-${i}`, owner, String(i).padStart(2, "0"), `Học sinh ${i}`);
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO questions VALUES (?,?,?)").run(`${owner}-q${i}`, owner, JSON.stringify({ question: `Câu ${i}`, option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A" }));
  }
  const cfg = { count: 2, seconds: 30, random: false, auto_next: false, allow_change: true, pass_mark: 5, leaderboard: false };
  const id = app.quiz.create(a.data.id, { class_id: a.data.id, bank_id: a.data.id, name: "ROOM test", config: cfg });
  const otherId = app.quiz.create(b.data.id, { class_id: b.data.id, bank_id: b.data.id, name: "Other", config: cfg });
  assert.equal((await pairing("open", id, other, { command_id: randomUUID(), expected_version: 0 })).status, 404);
  assert.equal((await request(`/api/sessions/${id}/pairing/open`, "POST", { command_id: "bad", expected_version: 0 }, { ...auth, csrf: "bad" })).status, 403);
  const opened = await pairing("open", id, auth);
  assert.equal(opened.status, 200); assert.match(opened.data.room_code, /^\d{8}$/);
  assert.equal((await pairing("open", id, auth, opened.input)).data.room_code, opened.data.room_code);
  assert.equal((await pairing("close", id, auth, opened.input)).data.code, "COMMAND_REUSED");
  assert.equal((await request(`/api/sessions/${id}/pairing`, "GET", undefined, other)).status, 404);
  assert.equal((await request(`/api/sessions/${id}/pairing`)).status, 401);
  const p = packet(opened.data.room_code);
  assert.equal((await request("/api/device-pairing/join", "POST", p, undefined, "https://bad.test")).status, 403);
  assert.equal((await nativeJoin({ ...p, room_code: "invalid" })).status, 422);
  assert.equal((await nativeJoin({ ...p, room_code: "999999999" })).status, 422);
  const joined = await nativeJoin(p);
  assert.equal(joined.status, 201); assert.equal(joined.data.status, "UNASSIGNED");
  const device = joined.data.device_id;
  assert.equal(JSON.stringify(joined.data).includes(p.device_secret), false);
  assert.equal(db.prepare("SELECT secret_hash FROM devices WHERE id=?").get(device).secret_hash.length, 64);
  assert.notEqual(db.prepare("SELECT secret_hash FROM devices WHERE id=?").get(device).secret_hash, p.device_secret);
  assert.equal((await nativeJoin(p)).data.device_id, device);
  assert.equal((await nativeJoin({ ...p, device_name: "changed" })).data.code, "REQUEST_REUSED");
  const deviceCount = db.prepare("SELECT count(*) n FROM devices").get().n;
  db.exec("CREATE TRIGGER fail_join BEFORE INSERT ON room_join_receipts BEGIN SELECT RAISE(ABORT,'test storage failure'); END");
  assert.ok((await nativeJoin(packet(opened.data.room_code))).status >= 400);
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, deviceCount);
  db.exec("DROP TRIGGER fail_join");
  let client = await connect(device, p.device_secret);
  const unassigned = await client.wait("session.snapshot");
  assert.equal(unassigned.data.assignment, "UNASSIGNED");
  assert.equal(unassigned.data.id, id);
  assert.equal(JSON.stringify(unassigned).includes(opened.data.room_code), false);
  client.send({ v: 1, type: "button.test", choice: "C" });
  assert.equal((await client.wait("button.ack")).assigned, false);
  assert.equal((await snapshot(id, auth)).room_devices[0].test_choice, "C");
  const st = (await snapshot(id, auth)).students[0];
  assert.equal((await request(`/api/sessions/${id}/bindings/${st.id}`, "PUT", { device_id: device }, other)).status, 404);
  assert.equal((await request(`/api/sessions/${id}/bindings/${st.id}`, "PUT", { device_id: device }, auth)).status, 200);
  assert.equal((await request(`/api/sessions/${id}/bindings/${(await snapshot(id, auth)).students[1].id}`, "PUT", { device_id: device }, auth)).status, 409);
  const rebind = async (student, as = auth) => request(`/api/sessions/${id}/room-devices/${device}/student`, "PUT", { student_id: student, expected_version: (await snapshot(id, auth)).state_version }, as);
  assert.equal((await rebind(st.id, other)).status, 404);
  assert.equal((await rebind("missing-student")).status, 404);
  assert.equal(db.prepare("SELECT session_student_id FROM session_devices WHERE device_id=? AND active=1").get(device).session_student_id, st.id);
  assert.equal((await rebind((await snapshot(id, auth)).students[1].id)).status, 200);
  assert.equal((await rebind(st.id)).status, 200);
  const rotated = await pairing("open", id, auth);
  assert.notEqual(rotated.data.room_code, opened.data.room_code);
  assert.equal((await nativeJoin(packet(opened.data.room_code))).data.code, "ROOM_UNAVAILABLE");
  assert.equal((await nativeJoin({ ...packet(rotated.data.room_code), device_id: device, device_secret: p.device_secret })).data.device_id, device);
  const otherRoom = await pairing("open", otherId, other);
  assert.equal((await nativeJoin({ ...packet(otherRoom.data.room_code), device_id: device, device_secret: p.device_secret })).data.code, "DEVICE_OWNER_MISMATCH");
  assert.equal((await request("/api/simulator/pairing/join", "POST", packet(otherRoom.data.room_code), auth)).data.code, "ROOM_UNAVAILABLE");
  // Leading zero and spaces remain part of the code, not a numeric conversion.
  db.prepare("UPDATE room_pairing SET room_code='01234567' WHERE session_id=?").run(id);
  const sim = packet("0123 4567", "SIM");
  assert.equal((await request("/api/simulator/pairing/join", "POST", sim, auth)).status, 201);
  assert.equal((await nativeJoin({ ...sim, room_code: "01234567" })).status, 200);
  db.prepare("UPDATE room_pairing SET expires_at=? WHERE session_id=?").run(Date.now() - 1, id);
  assert.equal((await nativeJoin(packet("01234567"))).data.code, "ROOM_UNAVAILABLE");
  assert.equal((await nativeJoin(p)).status, 200); // committed receipt survives code expiry/rotation
  assert.equal((await request(`/api/sessions/${id}/pairing`, "GET", undefined, auth)).data.status, "EXPIRED");
  assert.equal((await command("start", id, auth)).status, 200);
  assert.equal((await rebind(null)).status, 409);
  assert.equal((await pairing("open", id, auth)).status, 409);
  assert.equal((await request(`/api/sessions/${id}/room-devices/${device}`, "DELETE", undefined, auth)).status, 409);
  let s = await client.wait("session.snapshot", m => m.data.state === "RUNNING");
  const answer = { v: 1, type: "answer.submit", request_id: randomUUID(), session_id: id, question_instance_id: s.data.question.id, binding_id: s.data.binding_id, seq: 1, choice: "A" };
  client.send(answer); assert.equal((await client.wait("answer.ack")).accepted, true);
  client.send(answer); assert.equal((await client.wait("answer.ack")).duplicate, true);
  client.send({ ...answer, request_id: randomUUID(), seq: 2, choice: "B" }); assert.equal((await client.wait("answer.ack")).accepted, true);
  client.send({ ...answer, request_id: randomUUID(), choice: "C" }); assert.equal((await client.wait("answer.ack")).code, "STALE_SEQUENCE");
  assert.equal((await command("pause", id, auth)).status, 200);
  const paused = await pairing("open", id, auth);
  assert.equal(paused.status, 200);
  client.send({ ...answer, request_id: randomUUID(), seq: 3 }); assert.equal((await client.wait("answer.ack")).code, "SESSION_PAUSED");
  client.ws.close(); await once(client.ws, "close");
  client = await connect(device, p.device_secret);
  assert.equal((await client.wait("session.snapshot")).data.current_answer.choice, "B");
  assert.equal((await command("resume", id, auth)).status, 200);
  assert.equal((await request(`/api/sessions/${id}/pairing`, "GET", undefined, auth)).data.status, "CLOSED");
  // Deadline remains server-owned for a device provisioned with a room code.
  db.prepare("UPDATE session_questions SET deadline_at=? WHERE session_id=? AND status='OPEN'").run(Date.now() - 1, id);
  app.quiz.tick();
  client.send({ ...answer, request_id: randomUUID(), seq: 3 }); assert.equal((await client.wait("answer.ack")).code, "QUESTION_CLOSED");
  assert.equal((await command("next", id, auth)).status, 200);
  // Restart from a real SQLite file: active question pauses, memberships/answers survive, join windows close.
  await app.close(); db.close(); db = openDb(join(dir, "test.sqlite")); await start();
  assert.equal((await snapshot(id, auth)).state, "PAUSED");
  assert.equal(db.prepare("SELECT choice FROM answers").get().choice, "B");
  assert.equal((await request(`/api/sessions/${otherId}/pairing`, "GET", undefined, other)).data.status, "CLOSED");
  assert.equal((await nativeJoin(p)).data.device_id, device);
  assert.equal((await command("finish", id, auth)).status, 200);
  const report = await request(`/api/sessions/${id}/report`, "GET", undefined, auth);
  assert.equal(report.status, 200);
  const excel = await fetch(config.origin + `/api/sessions/${id}/export.xlsx`, { headers: { Cookie: auth.cookie } });
  assert.equal(excel.status, 200);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await excel.arrayBuffer())); assert.ok(book.worksheets.length);
  assert.equal((await request(`/api/sessions/${id}/room-devices/${device}`, "DELETE", undefined, auth)).status, 409);
  // New room: 50 devices enter concurrently through one NAT, then connect through real WebSockets.
  const loadId = app.quiz.create(a.data.id, { class_id: a.data.id, bank_id: a.data.id, name: "50 devices", config: cfg });
  const loadRoom = await pairing("open", loadId, auth, { command_id: randomUUID(), expected_version: (await snapshot(loadId, auth)).state_version, auto_assign: true });
  const packets = Array.from({ length: 50 }, (_, i) => packet(loadRoom.data.room_code, `LOAD-${i}`));
  const joined50 = await Promise.all(packets.map(nativeJoin));
  for (const r of joined50) { assert.equal(r.status, 201, JSON.stringify(r.data)); assert.equal(r.data.status, "ASSIGNED"); }
  assert.equal((await nativeJoin(packet(loadRoom.data.room_code))).data.code, "ROOM_FULL");
  assert.equal((await nativeJoin(packets[0])).data.device_id, joined50[0].data.device_id);
  const clients = await Promise.all(joined50.map((r, i) => connect(r.data.device_id, packets[i].device_secret)));
  for (const c of clients) await c.wait("session.snapshot");
  const loadStudents = (await snapshot(loadId, auth)).students;
  assert.equal(new Set(loadStudents.map(st => st.device_id)).size, 50);
  const rows = loadStudents.map(st => ({ student_id: st.id, device_id: st.device_id }));
  assert.equal((await request(`/api/sessions/${loadId}/bindings`, "PUT", { rows }, auth)).status, 200);
  assert.equal((await snapshot(loadId, auth)).students.filter(st => st.online).length, 50);
  assert.equal((await command("start", loadId, auth)).status, 200);
  for (const [i, c] of clients.entries()) {
    const live = await c.wait("session.snapshot", m => m.data.state === "RUNNING");
    c.send({ v: 1, type: "answer.submit", request_id: randomUUID(), session_id: loadId, question_instance_id: live.data.question.id, binding_id: live.data.binding_id, seq: 1, choice: i % 2 ? "B" : "A" });
  }
  for (const c of clients) assert.equal((await c.wait("answer.ack")).accepted, true);
  assert.equal((await snapshot(loadId, auth)).answered, 50);
  assert.equal((await command("pause", loadId, auth)).status, 200);
  assert.equal((await request(`/api/sessions/${loadId}/room-devices/${joined50[0].data.device_id}`, "DELETE", undefined, auth)).status, 200);
  assert.equal((await nativeJoin(packets[0])).data.code, "DEVICE_REMOVED");
  assert.equal((await request(`/api/devices/${joined50[1].data.device_id}/revoke`, "POST", {}, auth)).status, 200);
  assert.equal((await nativeJoin(packets[1])).data.code, "DEVICE_REVOKED");
  assert.equal((await command("finish", loadId, auth)).status, 200);
  assert.equal((await request(`/api/sessions/${loadId}`, "DELETE", undefined, auth)).status, 200);
  assert.equal(db.prepare("SELECT count(*) n FROM room_devices WHERE session_id=?").get(loadId).n, 0);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  // Exhaust public attempts; no unbounded IP map, and Retry-After is available to firmware.
  let limited;
  for (let i = 0; i < 125; i++) {
    limited = await nativeJoin(packet("98765432"));
    if (limited.status === 429) break;
  }
  assert.equal(limited.status, 429); assert.equal(limited.retryAfter, "60");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  console.log("ROOM ID: tự vào, quyền/CSRF, mã/hạn, retry/rollback, binding, ACK/seq/deadline, pause/reconnect/restart, Excel, gỡ/thu hồi, 50 WebSocket và rate limit: đạt.");
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close(); db.close(); rmSync(dir, { recursive: true });
}
