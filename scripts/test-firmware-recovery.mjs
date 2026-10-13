import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

const root = fileURLToPath(new URL("../", import.meta.url)), firmware = join(root, "firmware/esp32-classroom");
const source = readFileSync(join(firmware, "src/main.cpp"), "utf8");
function fn(name) {
  const match = source.match(new RegExp(`^[^\\n]*\\b${name}\\([^;\\n]*\\) \\{`, "m"));
  assert.ok(match, `Missing firmware function: ${name}`);
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < source.length; i++) {
    depth += (source[i] === "{") - (source[i] === "}");
    if (!depth) return source.slice(match.index, i + 1);
  }
  throw Error(`Unclosed function: ${name}`);
}
const fixture = readFileSync(new URL("./fixtures/oled-display.cpp", import.meta.url), "utf8");
const marker = fixture.indexOf("// FIRMWARE_FUNCTIONS");
const support = fixture.slice(0, marker), helpers = fixture.slice(marker + "// FIRMWARE_FUNCTIONS".length, fixture.indexOf("int main()"));
const functions = ["wakeOled", "presentOledFrame", "oledState", "updateOledPower", "remainingMs", "canAnswer",
  "invalidateServerSnapshot", "forgetStoredAnswer", "clearPending", "validAnswerPayload", "savePendingAnswer", "loadRecoveryState", "reconcilePendingAnswer", "retryPendingAnswer",
  "sendJson", "sendButtonTest", "sendAnswer", "handleChoice", "renderStatus", "drawOledStatus", "updateOledDisplay",
  "showInput", "showRenameNotice", "handleKey", "handleWebSocketMessage", "onWebSocketEvent", "deviceConfigurationIsReady", "shouldKeepNetworkAlive", "connectToWebsite"].map(fn).join("\n\n");
const tests = readFileSync(new URL("./fixtures/firmware-recovery.cpp", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "smartclass-recovery-test-"));
try {
  writeFileSync(join(dir, "test.cpp"), support + functions + helpers + tests);
  const compiled = spawnSync(process.env.CXX || "g++", ["-std=c++17", "-O1", "-Wall", "-Wextra",
    "-I", join(firmware, "include"), "-I", join(firmware, ".pio/libdeps/esp32-c3-devkitm-1/ArduinoJson/src"),
    join(dir, "test.cpp"), "-o", join(dir, "test")], { encoding: "utf8", timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
  const tested = spawnSync(join(dir, "test"), [], { encoding: "utf8", timeout: 10000 });
  process.stdout.write(tested.stdout || "");
  assert.equal(tested.status, 0, tested.stderr || tested.error?.message);
} finally { rmSync(dir, { recursive: true, force: true }); }

// Real authenticated WebSockets and SQLite :memory:, without application .env or a board.
const { openDb } = await import("../dist/server/server/db.js");
const { createApplication } = await import("../dist/server/server/app.js");
const { hash } = await import("../dist/server/server/auth.js");
const db = openDb(":memory:");
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false,
  simulator: true, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
let app, backendCases = 0;
const sockets = [];
async function start() {
  app = createApplication(db, config);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  config.origin = `http://127.0.0.1:${app.server.address().port}`;
}
const owner = "fixture-teacher", device = randomUUID(), secret = randomBytes(32).toString("hex");
async function check(label, run) { await run(); backendCases++; console.log(`PASS: backend ${label}`); }
async function connect(authentication = secret) {
  const ws = new WebSocket(config.origin.replace(/^http/, "ws") + "/ws", {
    headers: { Origin: config.origin, Authorization: `Bearer ${authentication}`, "X-Device-Id": device },
  });
  sockets.push(ws);
  const messages = [];
  ws.on("message", data => messages.push(JSON.parse(data)));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return { ws, send: p => ws.send(JSON.stringify(p)), async wait(type, predicate = () => true) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const index = messages.findIndex(m => m.type === type && predicate(m));
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error(`Missing ${type}`);
  } };
}
const snapshot = async client => (await client.wait("session.snapshot")).data;
const command = (id, action) => app.quiz.command(id, owner,
  { action, command_id: randomUUID(), expected_version: app.quiz.get(id).state_version });
const counts = () => ({ bindings: db.prepare("SELECT count(*) n FROM session_devices").get().n,
  answers: db.prepare("SELECT * FROM answers ORDER BY session_question_id,session_student_id").all(),
  joins: db.prepare("SELECT count(*) n FROM room_join_receipts").get().n });
try {
  await start();
  db.prepare("INSERT INTO teachers VALUES (?, 'recovery@example.test', 'fixture', 0)").run(owner);
  db.prepare("INSERT INTO classes VALUES ('class', ?, 'Fixture', 0)").run(owner);
  db.prepare("INSERT INTO students VALUES ('st1','class','001','First'),('st2','class','1','Second')").run();
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES ('bank',?,'Fixture')").run(owner);
  for (let i = 1; i <= 2; i++) db.prepare("INSERT INTO questions VALUES (?,'bank',?)").run(`q${i}`,
    JSON.stringify({ question: "Question", option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct_answer: "A" }));
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,'Shared board',?)").run(device, owner, hash(secret));
  const create = () => app.quiz.create(owner, { class_id: "class", bank_id: "bank", name: "Fixture",
    config: { count: 2, seconds: 300, random: false, auto_next: false, allow_change: true, pass_mark: 5 } });
  let client, session, first, packet;
  await check("WAITING boots with credentials only and creates no binding", async () => {
    client = await connect(); const s = await snapshot(client);
    assert.equal(s.state, "WAITING"); assert.equal(s.assignment, "UNASSIGNED");
    assert.deepEqual(counts(), { bindings: 0, answers: [], joins: 0 }); client.ws.terminate();
  });
  await check("LOBBY reboot restores the existing manual binding without a room join", async () => {
    session = create(); const student = db.prepare("SELECT id FROM session_students WHERE session_id=? AND student_code='001'").get(session);
    app.quiz.bind(session, student.id, device, owner); const before = counts();
    client = await connect(); first = await snapshot(client);
    assert.equal(first.state, "LOBBY"); assert.equal(first.id, session); assert.ok(first.binding_id);
    assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("RUNNING reboot restores the same binding and authoritative question/deadline", async () => {
    command(session, "start"); const before = counts(); client = await connect(); const s = await snapshot(client);
    assert.equal(s.state, "RUNNING"); assert.equal(s.binding_id, first.binding_id);
    assert.ok(s.question.deadline_at > s.server_time); assert.deepEqual(counts(), before);
    packet = { v: 1, type: "answer.submit", request_id: "lost-ack", session_id: s.id,
      binding_id: s.binding_id, question_instance_id: s.question.id, seq: 1, choice: "A" };
    client.send(packet); assert.equal((await client.wait("answer.ack")).accepted, true); client.ws.terminate();
  });
  await check("lost ACK retries the exact request after reconnect without another answer write", async () => {
    const before = counts(); client = await connect(); const s = await snapshot(client);
    assert.deepEqual(s.current_answer, { choice: "A", seq: 1 }); client.send(packet);
    const ack = await client.wait("answer.ack"); assert.equal(ack.accepted, true); assert.equal(ack.duplicate, true);
    assert.equal(ack.request_id, packet.request_id); assert.deepEqual(counts(), before);
  });
  await check("stale sequence and reused request cannot overwrite the authoritative answer", async () => {
    const before = counts(); client.send({ ...packet, choice: "B" });
    assert.equal((await client.wait("answer.ack")).code, "REQUEST_REUSED");
    client.send({ ...packet, request_id: "stale", choice: "B" });
    assert.equal((await client.wait("answer.ack")).code, "STALE_SEQUENCE");
    assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("PAUSED reboot preserves binding/answer and resumes with the next sequence", async () => {
    command(session, "pause"); client = await connect(); const s = await snapshot(client);
    assert.equal(s.state, "PAUSED"); assert.equal(s.binding_id, first.binding_id); assert.equal(s.current_answer.seq, 1);
    assert.ok(s.question.remaining_ms > 0); command(session, "resume");
    client.send({ ...packet, request_id: "after-resume", seq: 2, choice: "B" });
    assert.equal((await client.wait("answer.ack")).accepted, true); client.ws.terminate();
  });
  await check("server restart preserves binding and reports PAUSED instead of inventing RUNNING", async () => {
    const before = counts(); for (const ws of sockets) ws.terminate(); await app.close(); await start();
    client = await connect(); const s = await snapshot(client);
    assert.equal(s.state, "PAUSED"); assert.equal(s.binding_id, first.binding_id); assert.equal(s.current_answer.seq, 2);
    assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("teacher rebind gives a new identity and rejects packets from the old binding", async () => {
    app.quiz.bind(session, db.prepare("SELECT id FROM session_students WHERE session_id=? AND student_code='001'").get(session).id, null, owner);
    app.quiz.bind(session, db.prepare("SELECT id FROM session_students WHERE session_id=? AND student_code='1'").get(session).id, device, owner);
    client = await connect(); const s = await snapshot(client); assert.notEqual(s.binding_id, packet.binding_id);
    const before = counts(); client.send(packet);
    assert.equal((await client.wait("answer.ack")).code, "DEVICE_NOT_ASSIGNED"); assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("FINISHED reboot retrieves the saved result without a new binding", async () => {
    command(session, "finish"); const before = counts(); client = await connect(); const s = await snapshot(client);
    assert.equal(s.state, "FINISHED"); assert.ok(s.result); assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("new session supersedes the old result and old requests cannot score the new student", async () => {
    const next = create(); app.quiz.bind(next, db.prepare("SELECT id FROM session_students WHERE session_id=? AND student_code='001'").get(next).id, device, owner);
    client = await connect(); const s = await snapshot(client); assert.equal(s.id, next); assert.equal(s.state, "LOBBY");
    const before = counts(); client.send({ ...packet, request_id: "old-after-finish" });
    assert.equal((await client.wait("answer.ack")).code, "DEVICE_NOT_ASSIGNED"); assert.deepEqual(counts(), before); client.ws.terminate();
  });
  await check("wrong credentials cannot authenticate or claim a binding", async () => {
    const before = counts(); await assert.rejects(connect(randomBytes(32).toString("hex"))); assert.deepEqual(counts(), before);
  });
  await check("revoked device cannot regain WebSocket or answer rights after reboot", async () => {
    db.prepare("UPDATE devices SET revoked=1 WHERE id=?").run(device); app.realtime.disconnectDevice(device);
    const before = counts(); await assert.rejects(connect()); assert.equal(app.quiz.answer(device, packet).code, "DEVICE_NOT_ASSIGNED");
    assert.deepEqual(counts(), before);
  });
  console.log(`${backendCases}/${backendCases} real WebSocket recovery compatibility scenarios PASS`);
} finally {
  for (const ws of sockets) ws.terminate();
  if (app) await app.close(); db.close();
}
