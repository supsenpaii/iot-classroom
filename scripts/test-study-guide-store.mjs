import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

// Saved AI study guides end to end: storage, cache, regenerate, void, options, quota, practice deck.
const dir = mkdtempSync(join(tmpdir(), "iot-study-store-"));
const db = openDb(join(dir, "t.sqlite"));
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false, simulator: false, trustProxy: 0,
  maxUpload: 5242880, openRouterApiKeys: [], geminiApiKey: "AIza-store-test-key", geminiModel: "gemini-test", aiDailyLimit: 3 };
let app, teacher, other, calls = [];
const realFetch = globalThis.fetch, realLog = console.log;
const guide = { explanations: [{ no: 1, correct: "A", explanation: "Cộng hai số được 2." }],
  practice: [1, 2, 3, 4, 5, 6].map(i => ({ topic: "Cộng", question: `Câu luyện ${i}?`, option_a: "1", option_b: "2", option_c: "3", option_d: "4", correct_answer: "B", explanation: `Vì ${i}.` })) };

async function request(path, { method = "GET", body, who = teacher } = {}) {
  const res = await realFetch(config.origin + path, { method,
    headers: { "Content-Type": "application/json", Origin: config.origin, Cookie: who.cookie, "X-CSRF-Token": who.csrf },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function register(email) {
  const res = await realFetch(config.origin + "/api/auth/register", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.origin }, body: JSON.stringify({ email, password: "store-test-password" }) });
  const data = await res.json();
  return { id: data.id, csrf: data.csrf, cookie: res.headers.get("set-cookie").split(";")[0] };
}
function seedSession(id, ownerId) {
  db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run("c" + id, ownerId, "Lớp");
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)").run("b" + id, ownerId, "Đề");
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)").run("d" + id, ownerId, "D", "h");
  db.prepare("INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,current_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0)")
    .run(id, ownerId, "c" + id, "b" + id, "Lớp", "Buổi " + id, "r" + id, '{"count":2,"seconds":20,"pass_mark":5,"leaderboard":false}', "FINISHED", 2);
  db.prepare("INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES (?,?,?,?,?)").run("st" + id, id, "x", "001", "Nguyễn Văn Bí Mật");
  db.prepare("INSERT INTO session_devices VALUES (?,?,?,?,1,0)").run("bd" + id, id, "st" + id, "d" + id);
  for (let i = 1; i <= 2; i++) {
    db.prepare("INSERT INTO session_questions(id,session_id,question_order,data,status,closed_at) VALUES (?,?,?,?,?,1)")
      .run(`q${id}${i}`, id, i, JSON.stringify({ question: `Đề ${i}`, option_a: "2", option_b: "3", option_c: "4", option_d: "5", correct_answer: "A", explanation: "", topic: "Cộng", difficulty: "easy" }), "CLOSED");
    db.prepare("INSERT INTO answers VALUES (?,?,?,?,?,?,?)").run(`q${id}${i}`, "st" + id, "bd" + id, i === 1 ? "B" : "A", 1, 1, 100);
  }
}
before(async () => {
  console.log = () => {};
  app = createApplication(db, config);
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  config.origin = `http://127.0.0.1:${app.server.address().port}`;
  teacher = await register("store-a@example.test");
  other = await register("store-b@example.test");
  seedSession("s1", teacher.id);
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("generativelanguage")) return realFetch(url, init);
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(guide) }] } }], modelVersion: "gemini-test" }), { status: 200 });
  };
});
after(async () => { globalThis.fetch = realFetch; console.log = realLog; await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (body, id = "s1", who = teacher) => request(`/api/sessions/${id}/study-guide`, { method: "POST", body, who });

test("first call generates and saves; second call is served from storage", async () => {
  const first = await post({ student_id: "sts1" });
  assert.equal(first.status, 200);
  assert.equal(first.data.cached, false);
  assert.equal(first.data.model, "gemini-test");
  assert.equal(first.data.practice.length, 3, "default is three practice questions");
  assert.equal(calls.length, 1);
  assert.match(calls[0].contents[0].parts[0].text, /đúng 3 câu/);
  assert.ok(!JSON.stringify(calls[0]).includes("Bí Mật"), "student name must not reach the AI");
  const second = await post({ student_id: "sts1" });
  assert.equal(second.data.cached, true);
  assert.equal(calls.length, 1, "no new AI request");
  assert.deepEqual(second.data.explanations, first.data.explanations);
});

test("the report carries saved guides so the page needs no extra request", async () => {
  const report = await request("/api/sessions/s1/report");
  assert.equal(report.data.study_guides.sts1.cached, true);
  assert.equal(report.data.study_guides.sts1.practice.length, 3);
});

test("regenerate calls the AI again, with chosen count and language", async () => {
  const again = await post({ student_id: "sts1", regenerate: true, practice_count: 5, lang: "en" });
  assert.equal(again.data.cached, false);
  assert.equal(again.data.practice.length, 5);
  assert.equal(again.data.lang, "en");
  assert.equal(calls.length, 2);
  assert.match(calls[1].contents[0].parts[0].text, /đúng 5 câu/);
  assert.match(calls[1].contents[0].parts[0].text, /entirely in clear English/);
});

test("daily limit stops further calls but still serves saved guides", async () => {
  const third = await post({ student_id: "sts1", regenerate: true });
  assert.equal(third.status, 200);
  const blocked = await post({ student_id: "sts1", regenerate: true });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, "AI_DAILY_LIMIT");
  assert.equal(calls.length, 3);
  assert.equal((await post({ student_id: "sts1" })).data.cached, true);
});

test("practice deck: cards from saved practice, public link, no student identity", async () => {
  const made = await request("/api/sessions/s1/study-guide/deck", { method: "POST", body: { student_id: "sts1" } });
  assert.equal(made.status, 201);
  assert.equal(made.data.cards, 3);
  const pub = await request(`/api/public/flashcards/${made.data.share_token}`);
  assert.equal(pub.status, 200);
  const text = JSON.stringify(pub.data);
  assert.ok(!text.includes("Bí Mật") && !text.includes("001"));
  assert.ok(text.includes("Câu luyện 1?"));
});

test("another teacher cannot read, generate or build a deck", async () => {
  assert.equal((await post({ student_id: "sts1" }, "s1", other)).status, 404);
  assert.equal((await request("/api/sessions/s1/study-guide/deck", { method: "POST", body: { student_id: "sts1" }, who: other })).status, 404);
  assert.equal((await request("/api/sessions/s1/report", { who: other })).status, 404);
});

test("deck needs a saved guide; voiding a question clears saved guides", async () => {
  seedSession("s2", teacher.id);
  const none = await request("/api/sessions/s2/study-guide/deck", { method: "POST", body: { student_id: "sts2" } });
  assert.equal(none.status, 409);
  assert.equal(none.data.code, "NO_GUIDE");
  assert.equal(db.prepare("SELECT count(*) n FROM study_guides WHERE session_id='s1'").get().n, 1);
  const voided = await request("/api/sessions/s1/questions/qs11/void", { method: "POST", body: { reason: "Đề sai" } });
  assert.equal(voided.status, 200);
  assert.equal(db.prepare("SELECT count(*) n FROM study_guides WHERE session_id='s1'").get().n, 0);
  assert.deepEqual((await request("/api/sessions/s1/report")).data.study_guides, {});
});
