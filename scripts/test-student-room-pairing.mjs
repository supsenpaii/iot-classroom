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
  const defaultDevice = await request("/api/devices", "POST", { label: "00" }, auth);
  assert.equal(defaultDevice.status, 201);
  db.prepare("INSERT INTO student_devices(student_id,device_id) VALUES (?,?)").run(`${a.data.id}-0`, defaultDevice.data.id);
  const id = app.quiz.create(a.data.id, { class_id: a.data.id, bank_id: a.data.id, name: "ROOM test", config: cfg });
  assert.equal(db.prepare("SELECT count(*) n FROM session_devices WHERE session_id=?").get(id).n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM room_devices WHERE session_id=?").get(id).n, 0);
  await connect(defaultDevice.data.id, defaultDevice.data.secret);
  assert.equal(app.quiz.deviceSnapshot(defaultDevice.data.id).state, "WAITING");
  const otherId = app.quiz.create(b.data.id, { class_id: b.data.id, bank_id: b.data.id, name: "Other", config: cfg });
  const opened = await pairing("open", id, auth);
  const p = { ...packet(opened.data.room_code), student_code: "07" };
  const joined = await nativeJoin(p);
  assert.equal(joined.status, 201);
  assert.equal(joined.data.label, "07");
  db.prepare("UPDATE devices SET label='old-name' WHERE id=?").run(joined.data.device_id);
  const renamed = await nativeJoin({ ...p, request_id: randomUUID(), device_id: joined.data.device_id });
  assert.equal(renamed.status, 201);
  assert.equal(renamed.data.device_id, joined.data.device_id);
  assert.equal(renamed.data.label, "07");
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(joined.data.device_id).label, "07");
  const binding = db.prepare("SELECT s.student_code FROM session_devices b JOIN session_students s ON s.id=b.session_student_id WHERE b.device_id=? AND b.active=1").get(joined.data.device_id);
  assert.equal(binding.student_code, "07");
  assert.equal((await nativeJoin(p)).data.duplicate, true);
  const count = db.prepare("SELECT count(*) n FROM devices").get().n;
  assert.equal((await nativeJoin({ ...packet(opened.data.room_code), student_code: "07" })).data.code, "STUDENT_ALREADY_BOUND");
  assert.equal((await nativeJoin({ ...packet(opened.data.room_code), student_code: "999" })).data.code, "STUDENT_UNAVAILABLE");
  db.prepare("UPDATE session_students SET absent=1 WHERE session_id=? AND student_code='08'").run(id);
  assert.equal((await nativeJoin({ ...packet(opened.data.room_code), student_code: "08" })).data.code, "STUDENT_UNAVAILABLE");
  assert.equal((await nativeJoin({ ...p, request_id: randomUUID(), device_id: joined.data.device_id, student_code: "09" })).data.code, "STUDENT_ALREADY_BOUND");
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, count);
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(joined.data.device_id).label, "07");
  await pairing("close", id, auth);
  assert.equal((await nativeJoin(p)).data.duplicate, true);
  let device = await connect(joined.data.device_id, p.device_secret);
  device.send({ v: 1, type: "device.rename", request_id: "rename-student", label: "09" });
  assert.equal((await device.wait("device.rename.ack")).accepted, true);
  assert.equal(app.quiz.deviceSnapshot(joined.data.device_id).state, "WAITING");
  assert.equal((await nativeJoin(p)).data.code, "DEVICE_REMOVED");
  const students = db.prepare("SELECT id,student_code FROM session_students WHERE session_id=?").all(id);
  assert.throws(() => app.quiz.bind(id, students.find(s => s.student_code === "07").id, joined.data.device_id, a.data.id), /Mã thiết bị phải trùng/);
  device = await connect(joined.data.device_id, p.device_secret);
  assert.equal(app.quiz.deviceSnapshot(joined.data.device_id).state, "WAITING");
  const reopened = await pairing("open", id, auth);
  for (const label of ["999", "08"]) {
    device.send({ v: 1, type: "device.rename", request_id: `rename-${label}`, label });
    const ack = await device.wait("device.rename.ack");
    assert.equal(ack.accepted, label !== "999");
    if (label === "999") assert.equal(ack.code, "STUDENT_UNAVAILABLE");
    assert.equal((await nativeJoin({ ...p, room_code: reopened.data.room_code, request_id: randomUUID(), device_id: joined.data.device_id, student_code: label })).data.code, "STUDENT_UNAVAILABLE");
    assert.equal(app.quiz.deviceSnapshot(joined.data.device_id).state, "WAITING");
  }
  device.send({ v: 1, type: "device.rename", request_id: "rename-back", label: "09" });
  assert.equal((await device.wait("device.rename.ack")).accepted, true);
  const joinAgain = { ...p, room_code: reopened.data.room_code, request_id: randomUUID(), device_id: joined.data.device_id, student_code: "09" };
  assert.equal((await nativeJoin({ ...joinAgain, request_id: randomUUID(), room_code: "00000000" })).data.code, "ROOM_UNAVAILABLE");
  assert.equal(app.quiz.deviceSnapshot(joined.data.device_id).state, "WAITING");
  assert.equal((await nativeJoin(joinAgain)).status, 201);
  assert.ok(app.quiz.deviceSnapshot(joined.data.device_id).binding_id);
  device = await connect(joined.data.device_id, p.device_secret);
  assert.ok(app.quiz.deviceSnapshot(joined.data.device_id).binding_id);
  await command("start", id, auth);
  device.send({ v: 1, type: "device.rename", request_id: "rename-running", label: "10" });
  assert.equal((await device.wait("device.rename.ack")).code, "DEVICE_BUSY");
  assert.equal(db.prepare("SELECT label FROM devices WHERE id=?").get(joined.data.device_id).label, "09");
  console.log("PASS: exact MSSV binding, duplicate retries, occupied/absent/unknown students, rollback, closed-room retry");
} finally {
  for (const ws of sockets) ws.terminate();
  await app.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
