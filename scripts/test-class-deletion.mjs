import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDb } from "../dist/server/server/db.js";
import { createApplication } from "../dist/server/server/app.js";

const db = openDb(":memory:");
const config = {
  origin: "", secret: randomBytes(48).toString("hex"), production: false,
  simulator: false, trustProxy: 0, maxUpload: 5242880, openRouterApiKeys: [],
};
const app = createApplication(db, config);
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
config.origin = `http://127.0.0.1:${app.server.address().port}`;
async function request(path, method = "GET", auth, body) {
  const response = await fetch(config.origin + path, {
    method,
    headers: {
      Origin: config.origin, "Content-Type": "application/json",
      ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
try {
  const first = await request("/api/auth/register", "POST", undefined, { email: "delete-a@example.test", password: "class-delete-test-password" });
  const second = await request("/api/auth/register", "POST", undefined, { email: "delete-b@example.test", password: "class-delete-test-password" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const auth = { cookie: first.cookie, csrf: first.data.csrf };
  const other = { cookie: second.cookie, csrf: second.data.csrf };
  const created = await request("/api/classes", "POST", auth, { name: "Lớp cần xóa" });
  const id = created.data.id;
  assert.equal((await request(`/api/classes/${id}`, "DELETE")).status, 401);
  assert.equal((await request(`/api/classes/${id}`, "DELETE", { ...auth, csrf: "invalid" })).status, 403);
  assert.equal((await request(`/api/classes/${id}`, "DELETE", other)).status, 404);
  db.prepare("INSERT INTO students VALUES (?,?,?,?)").run("student-delete", id, "01", "Học sinh");
  db.prepare("INSERT INTO devices(id,owner_teacher_id,label,secret_hash) VALUES (?,?,?,?)").run("device-delete", first.data.id, "Thiết bị", "hash");
  db.prepare("INSERT INTO student_devices VALUES (?,?)").run("student-delete", "device-delete");
  assert.equal((await request(`/api/classes/${id}`, "DELETE", auth)).status, 200);
  assert.equal(db.prepare("SELECT count(*) n FROM students").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM student_devices").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM devices").get().n, 1);
  assert.equal((await request(`/api/classes/${id}`, "GET", auth)).status, 404);
  assert.equal((await request(`/api/classes/${id}`, "DELETE", auth)).status, 404);
  for (const history of ["attendance", "quiz"]) {
    const cls = await request("/api/classes", "POST", auth, { name: "Lớp có lịch sử" });
    const classId = cls.data.id;
    db.prepare("INSERT INTO students VALUES (?,?,?,?)").run(history, classId, "01", "Học sinh giữ lại");
    if (history === "attendance") {
      db.prepare("INSERT INTO attendance_sessions(id,owner_teacher_id,class_id,class_name,state,created_at) VALUES (?,?,?,?,?,?)").run(history, first.data.id, classId, "Lớp", "CLOSED", Date.now());
    } else {
      db.prepare("INSERT INTO question_banks(id,owner_teacher_id,name) VALUES (?,?,?)").run("bank", first.data.id, "Bộ đề");
      db.prepare("INSERT INTO quiz_sessions(id,owner_teacher_id,class_id,bank_id,class_name,name,room_code,config,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(history, first.data.id, classId, "bank", "Lớp", "Buổi", "123456", "{}", "FINISHED", Date.now());
    }
    const result = await request(`/api/classes/${classId}`, "DELETE", auth);
    assert.equal(result.status, 409);
    assert.equal(result.data.code, "CLASS_HAS_HISTORY");
    assert.ok(db.prepare("SELECT id FROM classes WHERE id=?").get(classId));
    assert.ok(db.prepare("SELECT id FROM students WHERE class_id=?").get(classId));
  }
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  console.log("Xóa lớp: quyền sở hữu, CSRF, gỡ học sinh/thiết bị và bảo toàn lịch sử đạt.");
} finally {
  await app.close();
  db.close();
}
