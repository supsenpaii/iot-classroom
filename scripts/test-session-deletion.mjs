import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

const db = openDb(":memory:");
const config = { origin: "", secret: randomBytes(48).toString("hex"), production: false, simulator: false, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [] };
const app = createApplication(db, config);
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
config.origin = `http://127.0.0.1:${app.server.address().port}`;
async function request(path, method = "GET", auth, body) {
  const response = await fetch(config.origin + path, {
    method, headers: { Origin: config.origin, "Content-Type": "application/json", ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
try {
  const first = await request("/api/auth/register", "POST", undefined, { email: "session-a@example.test", password: "session-delete-test-password" });
  const second = await request("/api/auth/register", "POST", undefined, { email: "session-b@example.test", password: "session-delete-test-password" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const auth = { cookie: first.cookie, csrf: first.data.csrf };
  const other = { cookie: second.cookie, csrf: second.data.csrf };
  db.prepare("INSERT INTO classes VALUES (?,?,?,0)").run("class", first.data.id, "Lớp");
  db.prepare("INSERT INTO students VALUES (?,?,?,?)").run("student", "class", "01", "Học sinh");
  db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)").run("bank", first.data.id, "Bộ đề");
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)").run("device", first.data.id, "Thiết bị", "hash");
  const states = ["LOBBY", "FINISHED", "CANCELLED", "RUNNING", "PAUSED"];
  for (const [index, state] of states.entries()) {
    const id = `session-${state}`;
    db.prepare("INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,created_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, first.data.id, "class", "bank", "Lớp", "Buổi", String(index), "{}", state, Date.now(), state === "FINISHED" ? "IMPORT" : "LIVE");
    db.prepare("INSERT INTO session_students(id,session_id,student_id,student_code,full_name) VALUES (?,?,?,?,?)").run(id, id, "student", "01", "Học sinh");
    db.prepare("INSERT INTO session_devices VALUES (?,?,?,?,0,?)").run(id, id, id, "device", Date.now());
    db.prepare("INSERT INTO session_questions(id,session_id,question_order,data) VALUES (?,?,1,?)").run(id, id, "{}");
    db.prepare("INSERT INTO answers VALUES (?,?,?,?,?,?,?)").run(id, id, state === "FINISHED" ? null : id, "A", 1, Date.now(), 100);
    db.prepare("INSERT INTO answer_receipts VALUES (?,?,?,?,?)").run(id, "request", "hash", "{}", Date.now());
    db.prepare("INSERT INTO session_events(session_id,type,detail,created_at) VALUES (?,?,?,?)").run(id, "test", "{}", Date.now());
    db.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(id, "command", "hash", "{}");
    db.prepare("INSERT INTO access_tokens VALUES (?,?,?,?,?,?,0)").run(id, "projection", id, first.data.id, "sid", Date.now() + 60000);
    assert.equal((await request(`/api/sessions/${id}`, "DELETE")).status, 401);
    assert.equal((await request(`/api/sessions/${id}`, "DELETE", { ...auth, csrf: "wrong" })).status, 403);
    assert.equal((await request(`/api/sessions/${id}`, "DELETE", other)).status, 404);
    const result = await request(`/api/sessions/${id}`, "DELETE", auth);
    if (["RUNNING", "PAUSED"].includes(state)) {
      assert.equal(result.status, 409);
      assert.equal(result.data.code, "SESSION_ACTIVE");
      assert.ok(db.prepare("SELECT * FROM answers WHERE session_question_id=?").get(id));
      // Leave no active room for the next fixture or background timer.
      db.prepare("UPDATE quiz_sessions SET state='CANCELLED' WHERE id=?").run(id);
    } else {
      assert.equal(result.status, 200);
      assert.equal((await request(`/api/sessions/${id}/report`, "GET", auth)).status, 404);
      assert.equal((await request(`/api/sessions/${id}`, "DELETE", auth)).status, 404);
      for (const [table, key] of [["quiz_sessions", "id"], ["session_students", "session_id"], ["session_devices", "session_id"], ["session_questions", "session_id"], ["answers", "session_question_id"], ["answer_receipts", "binding_id"], ["session_events", "session_id"], ["commands", "session_id"], ["access_tokens", "resource_id"]])
        assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE ${key}=?`).get(id).n, 0, table);
    }
  }
  for (const table of ["classes", "students", "question_banks", "devices"])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM quiz_sessions").get().n, 2);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  console.log("Xóa buổi: quyền sở hữu, CSRF, trạng thái, đáp án import, dọn dữ liệu và giữ lớp/thiết bị đạt.");
} finally {
  await app.close();
  db.close();
}
