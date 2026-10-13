import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";
import { Attendance } from "../dist/server/server/live.js";

// All fixtures, including simulated legacy records, live only in this memory database.
const db = openDb(":memory:");
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false,
  simulator: true, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
const app = createApplication(db, config);
const sockets = [];
let auth;
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
config.origin = `http://127.0.0.1:${app.server.address().port}`;
async function request(path, method = "GET", body, teacher = true) {
  const response = await fetch(config.origin + path, {
    method, headers: { "Content-Type": "application/json", ...(teacher ? {
      Origin: config.origin, ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
    } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function snapshot(id) {
  const r = await request(`/api/sessions/${id}`);
  assert.equal(r.status, 200); return r.data;
}
async function command(id, action) {
  const r = await request(`/api/sessions/${id}/commands`, "POST", {
    action, command_id: randomUUID(), expected_version: (await snapshot(id)).state_version,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function open(id) {
  const r = await request(`/api/sessions/${id}/pairing/open`, "POST", {
    command_id: randomUUID(), expected_version: (await snapshot(id)).state_version, auto_assign: true,
  });
  assert.equal(r.status, 200); return r.data.room_code;
}
const nativeJoin = body => request("/api/device-pairing/join", "POST", body, false);
async function connect(device) {
  const ws = new WebSocket(config.origin.replace(/^http/, "ws") + "/ws", {
    headers: { Authorization: `Bearer ${device.secret}`, "X-Device-Id": device.id },
  });
  const messages = [];
  ws.on("message", raw => messages.push(JSON.parse(raw)));
  sockets.push(ws);
  await once(ws, "open");
  return { ws, async wait(type, predicate = () => true) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const i = messages.findIndex(m => m.type === type && predicate(m));
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error(`Missing ${type}`);
  }, send(packet) { ws.send(JSON.stringify(packet)); } };
}
try {
  const teacher = await request("/api/auth/register", "POST", { email: "reuse@example.test", password: "DeviceReuseTest2026!" });
  assert.equal(teacher.status, 201);
  auth = { cookie: teacher.cookie, csrf: teacher.data.csrf };
  const owner = teacher.data.id;
  db.prepare("INSERT INTO classes VALUES ('c',?,'Reuse',0)").run(owner);
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank',?,'Bank')").run(owner);
  db.prepare("INSERT INTO questions VALUES ('q','bank',?)").run(JSON.stringify({ question: "Q", option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A" }));
  for (const code of ["001", "002", "003"])
    db.prepare("INSERT INTO students VALUES (?, 'c', ?, ?)").run(code, code, `Student ${code}`);
  async function device(label) {
    const r = await request("/api/devices", "POST", { label });
    assert.equal(r.status, 201); return r.data;
  }
  const board = await device("ESP32-A"), spare = await device("001");
  const credentials = db.prepare("SELECT id,secret_hash,label FROM devices WHERE id=?").get(board.id);
  db.prepare("INSERT INTO student_devices VALUES ('001',?)").run(board.id);
  const mapping = db.prepare("SELECT * FROM student_devices").all();
  const cfg = { count: 1, seconds: 30, random: false, auto_next: false, allow_change: true, pass_mark: 5, leaderboard: false };
  const create = name => app.quiz.create(owner, { class_id: "c", bank_id: "bank", name, config: cfg });
  const id = create("First"), other = create("Other lobby");
  const room = await open(id), otherRoom = await open(other);
  const packet = { v: 1, room_code: room, request_id: randomUUID(), device_id: board.id,
    device_secret: board.secret, device_name: "001", student_code: "001" };
  assert.equal((await nativeJoin({ ...packet, request_id: randomUUID(), student_code: "999" })).data.code, "STUDENT_UNAVAILABLE");
  assert.equal((await nativeJoin(packet)).data.status, "ASSIGNED");
  assert.deepEqual(db.prepare("SELECT id,secret_hash,label FROM devices WHERE id=?").get(board.id), credentials);
  assert.equal((await nativeJoin({ ...packet, request_id: randomUUID(), room_code: otherRoom, student_code: "002" })).data.code, "DEVICE_BUSY");
  assert.equal((await nativeJoin({ ...packet, request_id: randomUUID(), device_id: spare.id, device_secret: spare.secret })).data.code, "STUDENT_ALREADY_BOUND");
  // A numeric inventory label is not an identity, even with legacy auto_assign=true.
  const manualPacket = { ...packet, request_id: randomUUID(), device_id: spare.id, device_secret: spare.secret };
  delete manualPacket.student_code;
  const manual = await request("/api/simulator/pairing/join", "POST", manualPacket);
  assert.equal(manual.status, 201); assert.equal(manual.data.status, "UNASSIGNED");
  const roster = (await snapshot(id)).students;
  const student = code => roster.find(st => st.student_code === code).id;
  const rebind = async target => request(`/api/sessions/${id}/room-devices/${board.id}/student`, "PUT", {
    student_id: target, expected_version: (await snapshot(id)).state_version,
  });
  assert.equal((await request(`/api/sessions/${id}/bindings/${student("002")}`, "PUT", { device_id: spare.id })).status, 200);
  const oldBinding = app.quiz.deviceSnapshot(board.id).binding_id;
  assert.equal((await rebind(student("002"))).status, 409);
  assert.equal((await rebind("missing-student")).status, 404);
  db.prepare("UPDATE session_students SET absent=1 WHERE id=?").run(student("003"));
  assert.ok((await rebind(student("003"))).status >= 400);
  assert.equal(app.quiz.deviceSnapshot(board.id).binding_id, oldBinding);
  db.prepare("UPDATE session_students SET absent=0 WHERE id=?").run(student("003"));
  let client = await connect(board);
  await client.wait("session.snapshot");
  await command(id, "start");
  assert.equal((await rebind(student("003"))).status, 409);
  const live = (await client.wait("session.snapshot", m => m.data.state === "RUNNING")).data;
  const answer = { v: 1, type: "answer.submit", request_id: randomUUID(), session_id: id,
    question_instance_id: live.question.id, binding_id: oldBinding, seq: 1, choice: "A" };
  client.send(answer); assert.equal((await client.wait("answer.ack")).accepted, true);
  client.send(answer); assert.equal((await client.wait("answer.ack")).duplicate, true);
  await command(id, "pause");
  assert.equal((await rebind(student("003"))).status, 200);
  const newBinding = app.quiz.deviceSnapshot(board.id).binding_id;
  assert.notEqual(newBinding, oldBinding);
  // Join receipt replay must not move the teacher's new binding back to the old pupil.
  assert.equal((await nativeJoin(packet)).data.duplicate, true);
  assert.equal(app.quiz.deviceSnapshot(board.id).binding_id, newBinding);
  client.send(answer); assert.equal((await client.wait("answer.ack")).code, "DEVICE_NOT_ASSIGNED");
  client.ws.close(); await once(client.ws, "close");
  client = await connect(board);
  const recovered = (await client.wait("session.snapshot")).data;
  assert.equal(recovered.binding_id, newBinding); assert.equal(recovered.current_answer, null);
  await command(id, "resume");
  await client.wait("session.snapshot", m => m.data.state === "RUNNING");
  const newAnswer = { ...answer, binding_id: newBinding, request_id: randomUUID(), choice: "B" };
  client.send(newAnswer); assert.equal((await client.wait("answer.ack")).accepted, true);
  client.send(newAnswer); assert.equal((await client.wait("answer.ack")).duplicate, true);
  client.send({ ...newAnswer, choice: "C" }); assert.equal((await client.wait("answer.ack")).code, "REQUEST_REUSED");
  client.send(answer); assert.equal((await client.wait("answer.ack")).code, "DEVICE_NOT_ASSIGNED");
  await command(id, "finish");
  const scores = app.quiz.report(id).students;
  assert.equal(scores.find(st => st.student_code === "001").score, 10);
  assert.equal(scores.find(st => st.student_code === "003").score, 0);
  // Model an existing database where old binding.changed events lack label snapshots.
  db.prepare("UPDATE session_events SET detail=json_remove(detail,'$.binding_id','$.device_label') WHERE session_id=? AND type='binding.changed'").run(id);
  const history = app.quiz.report(id);
  const next = create("Next session"), nextRoom = await open(next);
  const reused = await nativeJoin({ ...packet, room_code: nextRoom, request_id: randomUUID(), student_code: "002" });
  assert.equal(reused.status, 201); assert.equal(reused.data.device_id, board.id);
  const nextBinding = app.quiz.deviceSnapshot(board.id).binding_id;
  assert.notEqual(nextBinding, newBinding);
  assert.deepEqual(db.prepare("SELECT id,secret_hash,label FROM devices WHERE id=?").get(board.id), credentials);
  assert.deepEqual(app.quiz.report(id), history);
  client.send(answer);
  const oldAck = await client.wait("answer.ack");
  assert.equal(oldAck.duplicate, true); // finished receipt replay acknowledges only the old answer
  assert.equal(db.prepare("SELECT count(*) n FROM answers a JOIN session_questions q ON q.id=a.session_question_id WHERE q.session_id=?").get(next).n, 0);
  assert.equal((await nativeJoin(packet)).data.duplicate, true);
  assert.equal(app.quiz.deviceSnapshot(board.id).binding_id, nextBinding);
  assert.deepEqual(app.quiz.report(id), history);
  await command(next, "start");
  await command(next, "finish");
  client.send({ v: 1, type: "device.rename", request_id: randomUUID(), label: "003" });
  assert.equal((await client.wait("device.rename.ack")).accepted, true);
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(board.id).label, "003");
  const preserved = app.quiz.report(id);
  const labelEvents = preserved.events.filter(e => e.type === "binding.label.snapshot");
  assert.equal(labelEvents.length, 2);
  assert.deepEqual(new Set(labelEvents.map(e => JSON.parse(e.detail).binding_id)), new Set([oldBinding, newBinding]));
  for (const e of labelEvents) assert.equal(JSON.parse(e.detail).device_label, "ESP32-A");
  // Preservation adds audit records; every original event and all report data stay identical.
  assert.deepEqual({ ...preserved, events: preserved.events.filter(e => e.type !== "binding.label.snapshot") }, history);
  client.send({ v: 1, type: "device.rename", request_id: randomUUID(), label: "003" });
  assert.equal((await client.wait("device.rename.ack")).accepted, true);
  assert.deepEqual(app.quiz.report(id), preserved);
  assert.equal(db.prepare("SELECT secret_hash FROM devices WHERE id=?").get(board.id).secret_hash, credentials.secret_hash);
  assert.deepEqual(db.prepare("SELECT * FROM student_devices").all(), mapping);
  const attendance = new Attendance(db);
  const attendanceId = attendance.create(owner, "c");
  assert.equal(db.prepare("SELECT student_code FROM attendance_marks WHERE attendance_id=? AND device_id=?").get(attendanceId, board.id).student_code, "001");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  console.log("PASS: stable device identity, explicit/manual MSSV, busy/occupied/absent rollback, rebind ACK isolation, reconnect, cross-session reuse, legacy report labels and unchanged attendance mapping.");
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close(); db.close();
}
